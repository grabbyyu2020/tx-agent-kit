import { AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { badRequest, type CoreError } from '../../../errors.js'
import { readCentsAsDecimillicents, readStringField } from './billing-event-fields.js'
import {
  isPositiveSafeInteger,
  toCoreInternal,
  type BillingWebhookHandlerInput
} from './billing-use-case-support.js'

// payment_intent.succeeded carrying an autoRechargeAttemptId (3DS-completed auto-recharge)
export const handleAutoRechargePaymentIntentSucceeded = (
  {
    event,
    organizationId,
    creditService,
    attemptStore
  }: BillingWebhookHandlerInput,
  autoRechargeAttemptId: string
): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    const stripePaymentIntentId = readStringField(event.data.object, 'id')
    const amountDecimillicents =
      readCentsAsDecimillicents(event.data.object, 'amount_received')
      ?? readCentsAsDecimillicents(event.data.object, 'amount')

    if (
      !stripePaymentIntentId
      || amountDecimillicents === null
      || amountDecimillicents <= 0
      || amountDecimillicents > AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
    ) {
      return yield* Effect.fail(
        badRequest(
          `payment_intent.succeeded ${event.id} is missing a usable payment_intent id or bounded amount for auto-recharge reconciliation`
        )
      )
    }

    // Mirror chargeAutoRecharge's ordering: Stripe has already
    // settled, but the local wallet credit is the state that
    // matters for the user. If crediting fails, keep the
    // requires-action attempt non-terminal and release the
    // processed_stripe_events claim so Stripe redelivery can retry
    // the idempotent credit append and then mark success.
    yield* creditService.creditsRecharged({
      organizationId,
      amountDecimillicents,
      stripePaymentIntentId,
      stripeEventId: event.id,
      referenceId: `stripe:auto-recharge:${autoRechargeAttemptId}`,
      reason: 'Auto-recharge'
    })

    yield* attemptStore
      .markAttemptSucceeded(autoRechargeAttemptId, stripePaymentIntentId)
      .pipe(Effect.mapError(toCoreInternal('Failed to persist auto-recharge webhook attempt state')))
  })

// charge.dispute.created
export const handleChargeDisputeCreated = ({
  event,
  organizationId,
  creditLedgerStore
}: BillingWebhookHandlerInput): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    // @spec INV-BILLING-009 — freeze the org's credit balance by
    // appending a zero-amount `adjustment` ledger row with
    // `dispute_hold` metadata, and atomically emit
    // `billing.dispute_created` via the outbox.
    const chargeAmountDecimillicents = readCentsAsDecimillicents(
      event.data.object,
      'amount'
    )
    if (
      chargeAmountDecimillicents === null
      || !isPositiveSafeInteger(chargeAmountDecimillicents)
    ) {
      return yield* Effect.fail(
        badRequest(
          `charge.dispute.created ${event.id} is missing a usable positive amount field`
        )
      )
    }
    yield* creditLedgerStore.append({
      organizationId,
      entryType: 'adjustment',
      amountDecimillicents: 0,
      reason: 'Dispute hold — credit balance frozen',
      referenceId: `stripe:dispute-created:${event.id}`,
      stripeEventId: event.id,
      metadata: {
        disputeHold: true,
        chargeAmountDecimillicents
      },
      outboxEvent: {
        eventType: 'billing.dispute_created',
        aggregateType: 'billing',
        aggregateId: organizationId,
        payload: {
          organizationId,
          stripeEventId: event.id,
          chargeAmountDecimillicents
        },
        correlationId: null
      }
    }).pipe(Effect.mapError(toCoreInternal('Failed to persist dispute hold')))
  })

// charge.dispute.closed
export const handleChargeDisputeClosed = ({
  event,
  organizationId,
  creditLedgerStore
}: BillingWebhookHandlerInput): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    // @spec INV-BILLING-009 — emit `billing.dispute_resolved` with
    // the outcome. On 'lost', also append a negative `adjustment`
    // ledger row atomically with the event.
    //
    // Fail-closed: reject unknown statuses with 4xx so Stripe retries
    // and on-call can investigate — a missing/unexpected status must
    // NOT silently map to 'won' (skipping a real deduction would be
    // irreversible customer money loss).
    const rawOutcome = readStringField(event.data.object, 'status')
      ?? readStringField(event.data.object, 'outcome')
    if (
      rawOutcome !== 'won'
      && rawOutcome !== 'lost'
      && rawOutcome !== 'warning_closed'
    ) {
      return yield* Effect.fail(
        badRequest(
          `charge.dispute.closed ${event.id} has unrecognised status="${rawOutcome ?? 'null'}" — refusing to process for financial safety`
        )
      )
    }
    const outcome: 'won' | 'lost' = rawOutcome === 'lost' ? 'lost' : 'won'
    const parsedChargeAmountDecimillicents = readCentsAsDecimillicents(
      event.data.object,
      'amount'
    )
    if (
      outcome === 'lost'
      && (
        parsedChargeAmountDecimillicents === null
        || !isPositiveSafeInteger(parsedChargeAmountDecimillicents)
      )
    ) {
      return yield* Effect.fail(
        badRequest(
          `charge.dispute.closed ${event.id} lost outcome is missing a usable positive amount field`
        )
      )
    }
    const chargeAmountDecimillicents = parsedChargeAmountDecimillicents ?? 0
    const adjustmentAmount = outcome === 'lost' ? -chargeAmountDecimillicents : 0
    yield* creditLedgerStore.append({
      organizationId,
      entryType: 'adjustment',
      amountDecimillicents: adjustmentAmount,
      reason: outcome === 'lost'
        ? 'Dispute lost — deducting disputed amount'
        : 'Dispute won — releasing hold',
      referenceId: `stripe:dispute-closed:${event.id}`,
      stripeEventId: event.id,
      metadata: {
        disputeResolved: true,
        outcome,
        chargeAmountDecimillicents
      },
      outboxEvent: {
        eventType: 'billing.dispute_resolved',
        aggregateType: 'billing',
        aggregateId: organizationId,
        payload: {
          organizationId,
          outcome,
          // The worker's disputeResolvedWorkflow now tolerates a
          // missing chargeAmountDecimillicents (defaults to 0 on
          // the `won` path), but we emit it explicitly so the
          // `lost` path doesn't silently default to 0 when the
          // spec actually expected the disputed amount.
          chargeAmountDecimillicents,
          stripeEventId: event.id
        },
        correlationId: null
      }
    }).pipe(Effect.mapError(toCoreInternal('Failed to persist dispute resolution')))
  })

// charge.refunded
export const handleChargeRefunded = ({
  event,
  organizationId,
  creditLedgerStore
}: BillingWebhookHandlerInput): Effect.Effect<void, CoreError> =>
  Effect.gen(function* () {
    // @spec INV-BILLING-009 — Stripe-initiated refund (customer
    // portal, operator dashboard, or API). A refund event's
    // `amount_refunded` field is CUMULATIVE across every
    // refund ever applied to the charge, so computing the
    // per-event delta requires `previous_attributes.amount_refunded`.
    // For the first refund on a charge, previous is null →
    // delta is `amount_refunded - 0`.
    //
    // Append a negative `refund` ledger row in the same
    // transaction as a `billing.credits_refunded` outbox
    // event so downstream consumers (notifications, analytics)
    // see it atomically. The ledger allows the balance to go
    // negative — a customer refund for already-spent credits
    // leaves a debt, same as a dispute_lost.
    //
    // @spec INV-BILLING-CREDITS-NEVER-EXPIRE §"refund forgiveness"
    // SUBSCRIPTION REFUND FORGIVENESS: if the refunded charge
    // carries an `invoice` field, it originated from a Stripe
    // Invoice (subscription charge). Subscription charges do
    // NOT grant recurring credits — only the one-time welcome
    // credit is granted on the first successful invoice, and
    // welcome credits are refund-forgiven. Therefore a
    // subscription-invoice refund must NOT debit the ledger
    // at all (the welcome credit stays intact, the balance
    // is unchanged). Top-up and auto-recharge refunds have no
    // `invoice` field and continue through the normal debit path.
    const refundedInvoice = readStringField(event.data.object, 'invoice')
    if (refundedInvoice !== null && refundedInvoice !== '') {
      yield* Effect.logInfo(
        `charge.refunded ${event.id} has invoice=${refundedInvoice} — subscription refund, welcome credit refund-forgiven, skipping ledger debit`
      )
      // processWebhookEvent returns the same `idempotent: false` result
      // after every handler, so an early exit here yields that result.
      return
    }
    const cumulativeDmc =
      readCentsAsDecimillicents(event.data.object, 'amount_refunded')
    if (cumulativeDmc === null) {
      return yield* Effect.fail(
        badRequest(
          `charge.refunded ${event.id} is missing a usable cumulative amount_refunded field`
        )
      )
    }
    const previousDmc = event.data.previousAttributes
      ? readCentsAsDecimillicents(event.data.previousAttributes, 'amount_refunded')
      : 0
    if (previousDmc === null) {
      return yield* Effect.fail(
        badRequest(
          `charge.refunded ${event.id} has an unusable previous_attributes.amount_refunded field`
        )
      )
    }
    const refundDeltaDecimillicents = cumulativeDmc - previousDmc
    if (refundDeltaDecimillicents < 0) {
      return yield* Effect.fail(
        badRequest(
          `charge.refunded ${event.id} has a negative refund delta ${refundDeltaDecimillicents} (cumulative=${cumulativeDmc}, previous=${previousDmc})`
        )
      )
    }
    if (refundDeltaDecimillicents === 0) {
      yield* Effect.logWarning(
        `charge.refunded ${event.id} has zero delta (cumulative=${cumulativeDmc}, previous=${previousDmc}) — ignoring`
      )
    } else {
      const stripeChargeId = readStringField(event.data.object, 'id') ?? ''
      yield* creditLedgerStore.append({
        organizationId,
        entryType: 'refund',
        amountDecimillicents: -refundDeltaDecimillicents,
        reason: 'Stripe refund',
        referenceId: `stripe:refund:${event.id}`,
        stripeEventId: event.id,
        metadata: {
          stripeChargeId,
          cumulativeAmountRefundedDecimillicents: cumulativeDmc,
          previousAmountRefundedDecimillicents: previousDmc
        },
        outboxEvent: {
          eventType: 'billing.credits_refunded',
          aggregateType: 'billing',
          aggregateId: organizationId,
          payload: {
            organizationId,
            amountDecimillicents: refundDeltaDecimillicents,
            stripeEventId: event.id,
            stripeChargeId
          },
          correlationId: null
        }
      }).pipe(Effect.mapError(toCoreInternal('Failed to persist refund')))
    }
  })
