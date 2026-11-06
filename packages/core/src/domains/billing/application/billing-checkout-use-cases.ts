import {
  LOCAL_DEV_SUBSCRIPTION_PERIOD_MS,
  TOP_UP_MAX_DECIMILLICENTS,
  TOP_UP_MIN_DECIMILLICENTS,
  WELCOME_CREDIT_DECIMILLICENTS
} from '@tx-agent-kit/contracts'
import { type Context, Effect, Option } from 'effect'
import { badRequest, notFound } from '../../../errors.js'
import { toBillingSettings } from '../domain/billing-domain.js'
import { BillingStorePort, ClockPort, CreditServicePort, StripePort } from '../ports/billing-ports.js'
import type { BillingService } from './billing-service.js'
import {
  assertBillingAccess,
  ensureStripeCustomerId,
  toCoreInternal,
  toLocalStripeSuffix
} from './billing-use-case-support.js'

type BillingServiceShape = Context.Tag.Service<typeof BillingService>

export const billingCheckoutUseCases: Pick<
  BillingServiceShape,
  | 'createCheckoutSession'
  | 'completeLocalBillingSetup'
  | 'createPortalSession'
  | 'createTopUpSession'
> = {
  createCheckoutSession: (principal, input) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(input.organizationId, principal, true)
      const billingStore = yield* BillingStorePort
      const stripe = yield* StripePort

      const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      const portalBillingEmail =
        typeof settings.billingEmail === 'string' && settings.billingEmail.length > 0
          ? settings.billingEmail
          : `billing+${toLocalStripeSuffix(input.organizationId)}@example.com`

      const customerId = yield* ensureStripeCustomerId({
        billingStore,
        stripe,
        organizationId: input.organizationId,
        principalEmail: portalBillingEmail,
        currentCustomerId: settings.stripeCustomerId
      })

      return yield* stripe.createCheckoutSession({
        ...input,
        customerId
      }).pipe(Effect.mapError(toCoreInternal('Failed to create checkout session')))
    }),

  completeLocalBillingSetup: (principal, organizationId, input) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(organizationId, principal, true)
      const billingStore = yield* BillingStorePort
      const creditService = yield* CreditServicePort
      const clock = yield* ClockPort

      const current = yield* billingStore.getSubscriptionFields(organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      const now = yield* clock.now()
      const localStripeSuffix = toLocalStripeSuffix(organizationId)
      const nextSubscriptionId =
        current.stripeSubscriptionId && !current.stripeSubscriptionId.startsWith('sub_local_')
          ? current.stripeSubscriptionId
          : `sub_local_${input.subscriptionPlan}_${localStripeSuffix}`

      yield* billingStore.updateSubscriptionFields({
        organizationId,
        billingEmail: current.billingEmail ?? principal.email,
        stripeCustomerId: current.stripeCustomerId ?? `cus_local_${localStripeSuffix}`,
        stripeSubscriptionId: nextSubscriptionId,
        stripePaymentMethodId: current.stripePaymentMethodId ?? `pm_local_${localStripeSuffix}`,
        stripeMeteredSubscriptionItemId: null,
        isSubscribed: true,
        subscriptionStatus: 'active',
        subscriptionPlan: input.subscriptionPlan,
        subscriptionStartedAt: current.subscriptionStartedAt ?? now,
        subscriptionEndsAt: null,
        subscriptionCurrentPeriodEnd: new Date(now.getTime() + LOCAL_DEV_SUBSCRIPTION_PERIOD_MS),
        paymentGracePeriodEndsAt: null
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to persist local billing bootstrap state')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      yield* creditService.creditsPurchased({
        organizationId,
        amountDecimillicents: WELCOME_CREDIT_DECIMILLICENTS[input.subscriptionPlan],
        stripeEventId: `evt_local_welcome_credit_${localStripeSuffix}`,
        referenceId: `dev:local-welcome-credit:${organizationId}`,
        reason: 'Local development welcome credit'
      })

      const refreshed = yield* billingStore.getSubscriptionFields(organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to reload billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      return toBillingSettings(refreshed)
    }),

  createPortalSession: (principal, input) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(input.organizationId, principal, true)
      const billingStore = yield* BillingStorePort
      const stripe = yield* StripePort
      const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      const portalBillingEmail =
        typeof settings.billingEmail === 'string' && settings.billingEmail.length > 0
          ? settings.billingEmail
          : `billing+${toLocalStripeSuffix(input.organizationId)}@example.com`

      const customerId = yield* ensureStripeCustomerId({
        billingStore,
        stripe,
        organizationId: input.organizationId,
        principalEmail: portalBillingEmail,
        currentCustomerId: settings.stripeCustomerId
      })

      return yield* stripe.createPortalSession({
        ...input,
        customerId
      }).pipe(Effect.mapError(toCoreInternal('Failed to create billing portal session')))
    }),

  createTopUpSession: (principal, input) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(input.organizationId, principal, true)

      // Defence-in-depth bounds check: the HTTP schema enforces these
      // via TOP_UP_MIN/MAX_DECIMILLICENTS, but assert at the service
      // seam too so a future caller that bypasses the schema (e.g.
      // an admin CLI, a future internal API) can't slip past. Pull
      // the constants directly from @tx-agent-kit/contracts so the
      // two bounds never drift.
      //
      // @spec billing-and-pricing-design §"Top-up bounds"
      if (!Number.isInteger(input.amountDecimillicents)) {
        return yield* Effect.fail(badRequest('Top-up amount must be an integer number of decimillicents'))
      }
      if (input.amountDecimillicents < TOP_UP_MIN_DECIMILLICENTS) {
        return yield* Effect.fail(badRequest(
          `Top-up amount below minimum ${TOP_UP_MIN_DECIMILLICENTS.toString()} decimillicents (1 cent)`
        ))
      }
      if (input.amountDecimillicents > TOP_UP_MAX_DECIMILLICENTS) {
        return yield* Effect.fail(badRequest(
          `Top-up amount above maximum ${TOP_UP_MAX_DECIMILLICENTS.toString()} decimillicents ($500)`
        ))
      }

      const billingStore = yield* BillingStorePort
      const stripe = yield* StripePort

      const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      // Lazily claim a Stripe customer if the org doesn't have one yet —
      // mirrors the createCheckoutSession path so top-up works on
      // orgs that have never started a subscription.
      const customerId = yield* ensureStripeCustomerId({
        billingStore,
        stripe,
        organizationId: input.organizationId,
        principalEmail: principal.email,
        currentCustomerId: settings.stripeCustomerId
      })

      return yield* stripe.createTopUpSession({
        organizationId: input.organizationId,
        customerId,
        amountDecimillicents: input.amountDecimillicents,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl
      }).pipe(Effect.mapError(toCoreInternal('Failed to create top-up session')))
    })
}
