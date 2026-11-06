import { type Context, Effect, Option } from 'effect'
import { badRequest, internalError, type CoreError } from '../../../errors.js'
import {
  AutoRechargeAttemptStorePort,
  BillingStorePort,
  ClockPort,
  CreditLedgerStorePort,
  CreditServicePort,
  ProcessedStripeEventStorePort,
  StripePort,
  SubscriptionEventStorePort
} from '../ports/billing-ports.js'
import { readObjectField, readStringField, resolveOrganizationIdForEvent } from './billing-event-fields.js'
import type { BillingService } from './billing-service.js'
import { toCoreInternal, type BillingWebhookHandlerInput } from './billing-use-case-support.js'
import {
  handleAutoRechargePaymentIntentSucceeded,
  handleChargeDisputeClosed,
  handleChargeDisputeCreated,
  handleChargeRefunded
} from './billing-webhook-payment-handlers.js'
import {
  handleCheckoutSessionCompleted,
  handleInvoicePayment,
  handleSubscriptionCreatedOrUpdated,
  handleSubscriptionDeleted
} from './billing-webhook-subscription-handlers.js'

type BillingServiceShape = Context.Tag.Service<typeof BillingService>

export const processWebhookEvent: BillingServiceShape['processWebhookEvent'] = (rawBody, signature) =>
    Effect.gen(function* () {
      const stripe = yield* StripePort
      const eventStore = yield* SubscriptionEventStorePort
      const billingStore = yield* BillingStorePort
      const clock = yield* ClockPort
      const processedStripeEventStore = yield* ProcessedStripeEventStorePort
      const creditLedgerStore = yield* CreditLedgerStorePort
      const creditService = yield* CreditServicePort
      const attemptStore = yield* AutoRechargeAttemptStorePort

      const event = yield* stripe.constructWebhookEvent(rawBody, signature).pipe(
        Effect.mapError((cause) => badRequest('Invalid Stripe webhook signature', cause))
      )

      // @spec INV-BILLING-005 — primary idempotency gate. Atomic
      // INSERT ... ON CONFLICT DO NOTHING: if the row already exists this
      // returns false and we early-exit before any state-mutating work.
      const inserted = yield* processedStripeEventStore.tryInsert(event.id).pipe(
        Effect.mapError(toCoreInternal('Failed to claim processed_stripe_events row'))
      )

      if (!inserted) {
        return {
          processed: true as const,
          idempotent: true as const,
          eventId: event.id
        }
      }

      // @spec INV-BILLING-005 — the tryInsert above committed in its own
      // transaction. If the rest of this handler fails, a naïve retry
      // would hit the claim row and silently short-circuit as
      // `idempotent: true`, losing the state mutation that never
      // happened. Release the claim on failure so Stripe's retry
      // re-runs the handler end-to-end.
      const releaseClaim = processedStripeEventStore.deleteByEventId(event.id).pipe(Effect.ignore)

      return yield* Effect.gen(function* () {
      // Secondary audit log: subscription_events is still written as the
      // human-readable history of processed Stripe events. It is no longer
      // the primary idempotency gate — processed_stripe_events (above) is.
      const existingEventOpt = yield* eventStore.findByStripeEventId(event.id).pipe(
        Effect.mapError(toCoreInternal('Failed to check webhook audit log'))
      )

      const resolveBySubscriptionId = (subscriptionId: string): Effect.Effect<string | null, CoreError> =>
        billingStore
          .findByStripeSubscriptionId(subscriptionId)
          .pipe(
            Effect.mapError(toCoreInternal('Failed to resolve organization for subscription webhook')),
            Effect.map((opt) => Option.isSome(opt) ? opt.value.id : null)
          )

      const resolveByCustomerId = (customerId: string): Effect.Effect<string | null, CoreError> =>
        billingStore
          .findByStripeCustomerId(customerId)
          .pipe(
            Effect.mapError(toCoreInternal('Failed to resolve organization for customer webhook')),
            Effect.map((opt) => Option.isSome(opt) ? opt.value.id : null)
          )

      const organizationId = yield* resolveOrganizationIdForEvent(
        event.data.object,
        resolveBySubscriptionId,
        resolveByCustomerId
      )
      const eventMetadata = readObjectField(event.data.object, 'metadata') ?? null
      const autoRechargeAttemptId = eventMetadata
        ? readStringField(eventMetadata, 'autoRechargeAttemptId')
        : null
      const autoRechargeIntentCompleted =
        event.type === 'payment_intent.succeeded'
        && autoRechargeAttemptId !== null

      // Fail early for state-mutating event types when organizationId is unresolvable.
      // Returning an error (non-2xx) causes Stripe to retry the webhook later, when the
      // organization may be resolvable (e.g., after a checkout.session.completed arrives
      // first and links the Stripe customer). Without this guard the event would be
      // marked as processed with no state written — silent data loss.
      const stateMutatingEventTypes = new Set([
        'checkout.session.completed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_failed',
        'invoice.payment_succeeded',
        'charge.dispute.created',
        'charge.dispute.closed',
        'charge.refunded'
      ])

      if (!organizationId && (stateMutatingEventTypes.has(event.type) || autoRechargeIntentCompleted)) {
        return yield* Effect.fail(
          badRequest(`Cannot process ${event.type} webhook: unable to resolve organizationId`)
        )
      }

      const existingEvent = Option.getOrUndefined(existingEventOpt)
      const createdEvent = existingEvent ?? (yield* eventStore.create({
        stripeEventId: event.id,
        eventType: event.type,
        organizationId,
        payload: event.payload
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to persist webhook event')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(internalError('Failed to persist webhook event')),
          onSome: Effect.succeed
        }))
      ))

      // Audit-log bookkeeping: stamp subscription_events.processed_at.
      // Fire-and-forget — `processed_stripe_events.tryInsert` above is
      // the authoritative idempotency gate. Gating on this as well would
      // strand retries: if this attempt succeeds markProcessed but then
      // the handler fails, the released processed_stripe_events claim
      // lets Stripe retry, but the stale processed_at would wrongly
      // short-circuit the retry as idempotent. See INV-BILLING-005 and
      // billing-webhook-claim-rollback.e2e.
      yield* eventStore.markProcessed(createdEvent.id).pipe(
        Effect.mapError(toCoreInternal('Failed to stamp webhook audit log')),
        Effect.ignore
      )

      if (organizationId) {
        const handlerInput: BillingWebhookHandlerInput = {
          event,
          organizationId,
          stripe,
          billingStore,
          clock,
          creditLedgerStore,
          creditService,
          attemptStore
        }
        if (event.type === 'checkout.session.completed') {
          yield* handleCheckoutSessionCompleted(handlerInput)
        } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
          yield* handleSubscriptionCreatedOrUpdated(handlerInput)
        } else if (event.type === 'customer.subscription.deleted') {
          yield* handleSubscriptionDeleted(handlerInput)
        } else if (event.type === 'payment_intent.succeeded' && autoRechargeAttemptId !== null) {
          yield* handleAutoRechargePaymentIntentSucceeded(handlerInput, autoRechargeAttemptId)
        } else if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_succeeded') {
          yield* handleInvoicePayment(handlerInput)
        } else if (event.type === 'charge.dispute.created') {
          yield* handleChargeDisputeCreated(handlerInput)
        } else if (event.type === 'charge.dispute.closed') {
          yield* handleChargeDisputeClosed(handlerInput)
        } else if (event.type === 'charge.refunded') {
          yield* handleChargeRefunded(handlerInput)
        }
      }

      return {
        processed: true as const,
        idempotent: false as const,
        eventId: event.id
      }
      }).pipe(Effect.onError(() => releaseClaim))
    })
