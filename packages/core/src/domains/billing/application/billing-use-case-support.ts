import { Effect, Option } from 'effect'
import { badRequest, internalError, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  BillingStorePort,
  type AutoRechargeAttemptStorePort,
  type ClockPort,
  type CreditLedgerStorePort,
  type CreditServicePort,
  type StripePort,
  type StripeWebhookEvent
} from '../ports/billing-ports.js'

const canManageBilling = (role: string): boolean => role === 'admin'

export const validateOptionalDecimillicentSetting = (
  label: string,
  value: number | null | undefined,
  min: number,
  max?: number
): CoreError | null => {
  if (value === undefined || value === null) {
    return null
  }
  if (
    !Number.isFinite(value)
    || !Number.isInteger(value)
    || !Number.isSafeInteger(value)
    || value < min
    || (max !== undefined && value > max)
  ) {
    const range = max === undefined
      ? `>= ${min.toString()}`
      : `between ${min.toString()} and ${max.toString()}`
    return badRequest(`${label} must be an integer ${range} decimillicents, got ${String(value)}`)
  }
  return null
}

export const isPositiveSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 1

export const isSafeNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0

export const toLocalStripeSuffix = (organizationId: string): string =>
  organizationId.replaceAll('-', '')

const isLocalStripeCustomerId = (customerId: string | null | undefined): customerId is string =>
  typeof customerId === 'string' && customerId.startsWith('cus_local_')

export const ensureStripeCustomerId = (input: {
  readonly billingStore: Effect.Effect.Success<typeof BillingStorePort>
  readonly stripe: Effect.Effect.Success<typeof StripePort>
  readonly organizationId: string
  readonly principalEmail: string
  readonly currentCustomerId: string | null
}) =>
  Effect.gen(function* () {
    if (input.currentCustomerId && !isLocalStripeCustomerId(input.currentCustomerId)) {
      return input.currentCustomerId
    }

    const newCustomer = yield* input.stripe.createCustomer({
      organizationId: input.organizationId,
      email: input.principalEmail
    }).pipe(Effect.mapError(toCoreInternal('Failed to create Stripe customer')))

    if (input.currentCustomerId === null) {
      const claimedOpt = yield* input.billingStore.claimStripeCustomerId({
        organizationId: input.organizationId,
        stripeCustomerId: newCustomer.id
      }).pipe(Effect.mapError(toCoreInternal('Failed to update billing customer reference')))

      return Option.getOrElse(claimedOpt, () => newCustomer.id)
    }

    const updatedOpt = yield* input.billingStore.updateSubscriptionFields({
      organizationId: input.organizationId,
      stripeCustomerId: newCustomer.id
    }).pipe(Effect.mapError(toCoreInternal('Failed to replace local Stripe customer reference')))

    return yield* Option.match(updatedOpt, {
      onNone: () => Effect.fail(notFound('Organization not found')),
      onSome: (updated) => Effect.succeed(updated.stripeCustomerId ?? newCustomer.id)
    })
  })

export const assertBillingAccess = (
  organizationId: string,
  principal: { userId: string },
  requiresManageBilling: boolean
): Effect.Effect<void, CoreError, BillingStorePort> =>
  Effect.gen(function* () {
    const billingStore = yield* BillingStorePort
    const role = yield* billingStore.getMemberRole(organizationId, principal.userId).pipe(
      Effect.mapError(toCoreInternal('Failed to verify organization membership')),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(unauthorized('Not allowed to access this organization')),
        onSome: Effect.succeed
      }))
    )

    if (requiresManageBilling && !canManageBilling(role)) {
      return yield* Effect.fail(unauthorized('Only owners and admins can manage billing'))
    }
  })

export const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)

/**
 * Resolved ports and event context handed to each per-event-type
 * handler that `processWebhookEvent` dispatches to once the
 * organization for the Stripe event has been resolved.
 */
export type BillingWebhookHandlerInput = {
  readonly event: StripeWebhookEvent
  readonly organizationId: string
  readonly stripe: Effect.Effect.Success<typeof StripePort>
  readonly billingStore: Effect.Effect.Success<typeof BillingStorePort>
  readonly clock: Effect.Effect.Success<typeof ClockPort>
  readonly creditLedgerStore: Effect.Effect.Success<typeof CreditLedgerStorePort>
  readonly creditService: Effect.Effect.Success<typeof CreditServicePort>
  readonly attemptStore: Effect.Effect.Success<typeof AutoRechargeAttemptStorePort>
}
