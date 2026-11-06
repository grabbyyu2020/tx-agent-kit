import { AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS } from '@tx-agent-kit/contracts'
import { type Context, Effect, Option } from 'effect'
import { badRequest, notFound } from '../../../errors.js'
import {
  AutoRechargeAttemptStorePort,
  BillingStorePort,
  CreditServicePort,
  StripePort
} from '../ports/billing-ports.js'
import type { BillingService } from './billing-service.js'
import { toCoreInternal } from './billing-use-case-support.js'

type BillingServiceShape = Context.Tag.Service<typeof BillingService>

// @spec billing-and-pricing-design
// @spec INV-BILLING-009 — atomic ledger commit path.
export const chargeAutoRecharge: BillingServiceShape['chargeAutoRecharge'] = (input) =>
    Effect.gen(function* () {
      // Defensive validation at the service seam: the worker passes
      // `amountDecimillicents` straight through to Stripe's
      // `createOffSessionPaymentIntent` AND to the credit ledger
      // append. A NaN/Infinity would corrupt both: Stripe rejects
      // the payload loudly but our own `attempt.amount` bigint
      // column would silently store whatever JS coerces. A negative
      // amount would create a negative PaymentIntent and a credit
      // REFUND masquerading as a recharge. Same pattern as
      // credit-service.creditsRecharged — pin at the seam before
      // any external side effect fires.
      if (
        !Number.isFinite(input.amountDecimillicents)
        || !Number.isInteger(input.amountDecimillicents)
        || !Number.isSafeInteger(input.amountDecimillicents)
        || input.amountDecimillicents <= 0
        || input.amountDecimillicents > AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
      ) {
        return yield* Effect.fail(badRequest(
          `chargeAutoRecharge: amountDecimillicents must be a positive integer <= ${AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS.toString()}, got ${String(input.amountDecimillicents)}`
        ))
      }

      const billingStore = yield* BillingStorePort
      const stripe = yield* StripePort
      const creditService = yield* CreditServicePort
      const attemptStore = yield* AutoRechargeAttemptStorePort

      const settingsOpt = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch billing settings'))
      )

      if (Option.isNone(settingsOpt)) {
        return yield* Effect.fail(notFound('Organization not found'))
      }

      const settings = settingsOpt.value
      const customerId = settings.stripeCustomerId
      const paymentMethodId = settings.stripePaymentMethodId

      if (!settings.autoRechargeEnabled) {
        yield* attemptStore
          .markAttemptFailed(input.attemptId, 'auto-recharge disabled', null)
          .pipe(Effect.mapError(toCoreInternal('Failed to mark auto-recharge attempt failed')))
        return {
          status: 'failed' as const,
          stripePaymentIntentId: '',
          failureReason: 'auto-recharge disabled'
        }
      }

      if (!customerId || !paymentMethodId) {
        yield* attemptStore
          .markAttemptFailed(input.attemptId, 'no saved payment method', null)
          .pipe(Effect.mapError(toCoreInternal('Failed to mark auto-recharge attempt failed')))
        return {
          status: 'failed' as const,
          stripePaymentIntentId: '',
          failureReason: 'no saved payment method'
        }
      }

      const intent = yield* stripe
        .createOffSessionPaymentIntent({
          organizationId: input.organizationId,
          customerId,
          paymentMethodId,
          amountDecimillicents: input.amountDecimillicents,
          description: `Auto-recharge for organization ${input.organizationId}`,
          idempotencyKey: input.attemptId
        })
        .pipe(Effect.mapError(toCoreInternal('Failed to create off-session PaymentIntent')))

      if (intent.status === 'succeeded') {
        // Atomic ledger append + billing.credits_recharged outbox event
        // must happen BEFORE the attempt is marked terminal. If the
        // local credit commit fails after Stripe succeeds, leaving the
        // attempt pending lets a retry reuse the same Stripe idempotency
        // key and the same ledger referenceId. Marking succeeded first
        // could strand a paid PaymentIntent with no wallet credit.
        yield* creditService.creditsRecharged({
          organizationId: input.organizationId,
          amountDecimillicents: input.amountDecimillicents,
          stripePaymentIntentId: intent.id,
          stripeEventId: intent.id,
          referenceId: `auto-recharge:${input.attemptId}`,
          reason: 'Auto-recharge'
        })

        yield* attemptStore
          .markAttemptSucceeded(input.attemptId, intent.id)
          .pipe(Effect.mapError(toCoreInternal('Failed to mark auto-recharge attempt succeeded')))

        return {
          status: 'succeeded' as const,
          stripePaymentIntentId: intent.id,
          failureReason: null
        }
      }

      if (intent.status === 'requires_action') {
        // @spec billing-and-pricing-design §"3DS off-session challenge"
        // The PaymentIntent needs a 3DS challenge before settling. The
        // port writes the failed attempt row AND a
        // billing.recharge_requires_action outbox event in the same DB
        // transaction (INV-BILLING-009), so a downstream consumer
        // (frontend SSE / push notification) can surface the challenge
        // URL without the worker re-polling Stripe.
        //
        // If Stripe returned the intent without a client_secret (very
        // unusual — only happens when the API version pin elides it)
        // we fall back to the legacy markAttemptFailed path so the
        // attempt still terminates cleanly.
        if (intent.clientSecret) {
          yield* attemptStore
            .markAttemptRequiresActionAndEmit({
              attemptId: input.attemptId,
              organizationId: input.organizationId,
              amountDecimillicents: input.amountDecimillicents,
              stripePaymentIntentId: intent.id,
              clientSecret: intent.clientSecret
            })
            .pipe(Effect.mapError(toCoreInternal('Failed to mark auto-recharge requires_action')))
        } else {
          yield* attemptStore
            .markAttemptFailed(input.attemptId, 'requires user action', intent.id)
            .pipe(Effect.mapError(toCoreInternal('Failed to mark auto-recharge attempt failed')))
        }

        return {
          status: 'requires_action' as const,
          stripePaymentIntentId: intent.id,
          failureReason: 'requires user action'
        }
      }

      // requires_payment_method | canceled → treat as failed card decline.
      yield* attemptStore
        .markAttemptFailed(input.attemptId, 'card declined', intent.id)
        .pipe(Effect.mapError(toCoreInternal('Failed to mark auto-recharge attempt failed')))
      return {
        status: 'failed' as const,
        stripePaymentIntentId: intent.id,
        failureReason: 'card declined'
      }
    })
