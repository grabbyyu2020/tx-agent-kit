import { createLogger } from '@tx-agent-kit/logging'
import {
  autoRechargeAttemptsRepository,
  creditLedgerRepository,
  organizationsRepository,
  storageUsageRepository
} from '@tx-agent-kit/db'
import {
  BillingStorePortLive,
  ClockPortLive,
  CreditLedgerStorePortLive,
  makeCreditService,
  makeStorageBillingService,
  StorageUsageReaderPortLive
} from '@tx-agent-kit/core'
import {
  EmailDeliveryPort,
  EmailDeliveryPortLive
} from '@tx-agent-kit/email'
import { Effect, Layer, Option } from 'effect'
import type { SerializedDomainEvent } from './activities.js'
import {
  CreditServiceDependenciesLive,
  runAutoRechargeTrigger,
  runEffect
} from './billing-auto-recharge.js'

const logger = createLogger('tx-agent-kit-worker-billing-activities')

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isFinite(value)
  && Number.isInteger(value)
  && Number.isSafeInteger(value)
  && value > 0

/**
 * Module-level email delivery port reference. Defaults to the live Resend
 * adapter; tests can swap it out via {@link _setBillingEmailPortForTest}
 * to inject `createTestEmailDelivery()` from `@tx-agent-kit/testkit`
 * without needing an HTTP-level mock.
 */
let billingEmailLayer: Layer.Layer<EmailDeliveryPort> = EmailDeliveryPortLive

export const _setBillingEmailPortForTest = (
  portImpl: typeof EmailDeliveryPort.Service
): void => {
  billingEmailLayer = Layer.succeed(EmailDeliveryPort, portImpl)
}

export const _resetBillingEmailPortForTest = (): void => {
  billingEmailLayer = EmailDeliveryPortLive
}

export {
  _setBillingStripePortForTest,
  _resetBillingStripePortForTest
} from './billing-auto-recharge.js'

/**
 * Layer graph for {@link makeStorageBillingService}. The service reads the
 * org's subscription (BillingStorePort), writes ledger entries
 * (CreditLedgerStorePort), reads the current period's storage usage
 * (StorageUsageReaderPort) and occasionally needs wall-clock time
 * (ClockPort). All four live layers are wired here so the nightly
 * reconciliation activity can run the service end-to-end.
 *
 * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
 */
const StorageBillingServiceDependenciesLive = Layer.mergeAll(
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  StorageUsageReaderPortLive,
  ClockPortLive
)

/**
 * Billing domain activities invoked by the outbox poller.
 *
 * Every method is designed to be re-entrant. Temporal retries an activity on
 * failure, so a second execution of the same event must either produce the
 * same terminal state or be a no-op. Where possible, idempotency is enforced
 * at the DB layer (unique reference IDs, conditional updates); otherwise it
 * is enforced by checking for prior state before mutating.
 *
 * @spec INV-BILLING-010 — billing consumers are idempotent.
 */
export const billingActivities = {
  /**
   * Re-evaluate an organization's posture after a credit-positive event
   * (`billing.credits_purchased` / `billing.credits_recharged` /
   * `billing.dispute_resolved` outcome=won). When the available balance
   * (creditsBalance − reservedCredits) is positive AND the org is currently
   * suspended, clear `organizations.suspended_at` so credit-consuming
   * operations can resume.
   *
   * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
   * @spec INV-BILLING-010 — billing event consumers are idempotent.
   */
  creditPositiveReevaluate: async (orgId: string): Promise<void> => {
    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      logger.warn('Credit positive reevaluate: organization not found.', { orgId })
      return
    }

    const row = org.value
    const available = row.creditsBalance - row.reservedCredits
    const wasSuspended = row.suspendedAt !== null

    logger.info('Credit positive reevaluate: inspected organization state.', {
      orgId,
      creditsBalance: row.creditsBalance,
      reservedCredits: row.reservedCredits,
      available,
      usageCap: row.usageCap,
      wasSuspended
    })

    if (wasSuspended && available > 0) {
      // Use the atomic `clearSuspendedIfPositiveBalance` variant so the
      // balance predicate lives inside the UPDATE WHERE clause. This
      // closes a TOCTOU: between reading `row.creditsBalance` above and
      // firing `clearSuspended`, a concurrent `finalize` or
      // `charge.refunded` can drop balance below reservedCredits —
      // previously the unconditional clear would unsuspend the org with
      // a now-negative available balance. Now the DB re-evaluates the
      // predicate at write time; a stale positive read can no longer
      // unsuspend a currently-underwater org.
      const cleared = await runEffect(
        organizationsRepository.clearSuspendedIfPositiveBalance(orgId)
      )
      if (cleared.cleared) {
        logger.warn('Organization unsuspended after credit-positive event.', {
          organizationId: orgId,
          available
        })
      }
    }
  },

  /**
   * Execute the off-session auto-recharge loop end-to-end: reuse the latest
   * pending `auto_recharge_attempts` row (or create one), call Stripe via
   * `BillingService.chargeAutoRecharge`, update the attempt state, and on
   * success credit the ledger with a `billing.credits_recharged` outbox
   * event committed atomically alongside the positive ledger row.
   *
   * Idempotency:
   *   - The latest pending attempt for an org is reused on retries. If a
   *     prior run of this activity already succeeded, no new pending row
   *     exists and a fresh attempt is created — but the Stripe
   *     PaymentIntent carries the attempt id as its idempotency key, so a
   *     subsequent duplicate call to the same attempt never double-charges.
   *   - `BillingService.chargeAutoRecharge` never throws for normal failure
   *     modes (missing payment method, card decline, requires_action); the
   *     activity always completes and the attempt row captures the state.
   *
   * @spec billing-and-pricing-design
   * @spec INV-BILLING-009 — atomic ledger commit path via creditsRecharged.
   * @spec INV-BILLING-010 — billing consumers are idempotent.
   */
  triggerAutoRecharge: async (
    orgId: string,
    currentBalanceDecimillicents: number,
    thresholdDecimillicents: number
  ): Promise<void> => {
    await runAutoRechargeTrigger(orgId, currentBalanceDecimillicents, thresholdDecimillicents)
  },

  /**
   * Record a usage-cap warning threshold crossing
   * (`billing.usage_cap_warning`). The workflow calls `notifyBillingEvent`
   * after this activity so in-app + email delivery stay centralized in
   * the notification fan-out path and do not double-send on retries.
   *
   * Idempotency: the warning is fire-and-forget; Temporal retries land on
   * a fresh email send. The downstream Resend deliverability layer
   * deduplicates on its own headers.
   *
   * @spec billing-and-pricing-design §"Usage Cap System"
   */
  sendUsageCapWarning: async (
    orgId: string,
    percentUsed: number,
    capDecimillicents: number
  ): Promise<void> => {
    logger.warn('Usage cap warning threshold crossed.', {
      organizationId: orgId,
      percentUsed,
      capDecimillicents
    })

    await Promise.resolve()
  },

  /**
   * Apply the 100% usage cap breach. Sets `organizations.suspended_at` so
   * credit-consuming operations are blocked at the API layer until the
   * org tops up (which fires `billing.credits_purchased` →
   * `creditPositiveReevaluate` → unsuspend).
   *
   * Idempotency: `setSuspended` is conditional on `suspended_at IS NULL`
   * so retries do not overwrite the original suspension instant.
   *
   * @spec billing-and-pricing-design §"Usage Cap System"
   * @spec INV-BILLING-009 — usage_cap_exceeded fires before the consumer
   * blocks the org so the audit trail is complete even if the activity
   * fails halfway through.
   */
  applyUsageCapExceeded: async (
    orgId: string,
    capDecimillicents: number
  ): Promise<void> => {
    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      logger.warn('Usage cap exceeded: organization not found.', { orgId })
      return
    }

    const result = await runEffect(organizationsRepository.setSuspended(orgId))

    logger.error('Usage cap exceeded — organization suspended.', {
      organizationId: orgId,
      capDecimillicents,
      creditsBalance: org.value.creditsBalance,
      newlySuspended: result.suspended
    })
  },

  /**
   * Start the 7-day payment grace period after a Stripe
   * `invoice.payment_failed` webhook. The column exists on `organizations`
   * so we issue a single UPDATE.
   *
   * Idempotency: when the webhook event carries its synchronous
   * `gracePeriodEndsAt` deadline, the activity reuses that exact value.
   * Older events without the field fall back to now + gracePeriodDays.
   */
  startPaymentGracePeriod: async (
    orgId: string,
    gracePeriodDays: number,
    gracePeriodEndsAtIso?: string
  ): Promise<void> => {
    const explicitEndsAt = gracePeriodEndsAtIso ? new Date(gracePeriodEndsAtIso) : null
    const endsAt = explicitEndsAt && !Number.isNaN(explicitEndsAt.getTime())
      ? explicitEndsAt
      : new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000)

    await runEffect(
      organizationsRepository.setPaymentGracePeriod(orgId, endsAt)
    )

    logger.warn('Payment grace period started.', {
      organizationId: orgId,
      gracePeriodDays,
      endsAt: endsAt.toISOString(),
      source: explicitEndsAt && !Number.isNaN(explicitEndsAt.getTime()) ? 'event' : 'computed'
    })

    // Notification fan-out owns in-app + email delivery for this event.
    await Promise.resolve()
  },

  /**
   * Freeze the org's credit balance after a Stripe `charge.dispute.created`
   * webhook. Sets `organizations.suspended_at` — the same kill switch used
   * by usage-cap exceeded. The dispute outcome (`won`/`lost`) eventually
   * lands as `billing.dispute_resolved`; on `won` the credit-positive
   * re-evaluator clears the suspension, on `lost` the negative ledger
   * entry keeps the available balance ≤ 0 so the suspension persists.
   *
   * @spec billing-and-pricing-design §"Dispute Handling"
   */
  freezeCreditBalance: async (orgId: string): Promise<void> => {
    const result = await runEffect(organizationsRepository.setSuspended(orgId))
    logger.error('Credit balance frozen due to dispute — organization suspended.', {
      organizationId: orgId,
      newlySuspended: result.suspended
    })
  },

  /**
   * Resolve an open credit dispute. On `lost`, deduct the disputed amount
   * from the org's balance via a negative ledger entry with a
   * `dispute_resolution` reason. On `won`, no balance change — just a log.
   *
   * Idempotency: the ledger append uses `referenceId = dispute:<orgId>` so
   * retries of the same dispute resolution collapse to a single entry.
   */
  resolveCreditDispute: async (
    orgId: string,
    outcome: 'won' | 'lost',
    chargeAmountDecimillicents: number,
    stripeEventId: string | null = null
  ): Promise<void> => {
    if (outcome === 'won') {
      // @spec billing-and-pricing-design §"Dispute Handling"
      // freezeCreditBalance suspended the org on dispute_created. On 'won'
      // the hold must be released — the credit-positive re-evaluator
      // clears organizations.suspended_at IF the available balance is
      // positive. This is the symmetric counterpart to freezeCreditBalance
      // that the original implementation forgot to wire up.
      await billingActivities.creditPositiveReevaluate(orgId)
      logger.info('Credit dispute resolved in our favour — suspension re-evaluated.', {
        organizationId: orgId,
        chargeAmountDecimillicents
      })
      return
    }

    if (!isPositiveSafeInteger(chargeAmountDecimillicents)) {
      throw new Error(
        `lost dispute amount must be a positive integer <= Number.MAX_SAFE_INTEGER, got ${String(chargeAmountDecimillicents)}`
      )
    }

    // Align the referenceId with the webhook handler's inline write
    // (`stripe:dispute-closed:<evt>`) so the append's idempotency check
    // collapses the worker path with the webhook path — no double-
    // deduct. Fall back to the historical `dispute:<orgId>:<amount>`
    // shape only when the upstream event didn't carry the stripe id
    // (legacy replay / manual seed).
    const referenceId = stripeEventId
      ? `stripe:dispute-closed:${stripeEventId}`
      : `dispute:${orgId}:${String(chargeAmountDecimillicents)}`

    await runEffect(
      creditLedgerRepository.append({
        organizationId: orgId,
        entryType: 'adjustment',
        amountDecimillicents: -Math.abs(chargeAmountDecimillicents),
        reason: 'dispute_resolution',
        referenceId
      })
    )

    logger.warn('Credit dispute resolved against us — balance debited (or idempotent no-op).', {
      organizationId: orgId,
      chargeAmountDecimillicents,
      referenceId
    })
  },

  /**
   * Schedule an org-wide media purge 30 days after cancellation. Stub: log
   * only. The retention cleaner will do the actual deletions once wired to
   * a cancelled_at column.
   */
  scheduleOrgMediaPurge: async (orgId: string): Promise<void> => {
    logger.info('Scheduled org media purge after subscription cancellation.', {
      organizationId: orgId,
      purgeAfterDays: 30
    })
    await Promise.resolve()
  },

  /**
   * Scan for reservations older than `maxAgeSeconds` that never reached a
   * `finalize` or `release` and append compensating release rows for each
   * one. Driven by `releaseStaleReservationsWorkflow` on a 10-minute
   * interval.
   *
   * Idempotency: the underlying scan excludes any reserve whose close-row
   * (`cancel:<id>` / `release:<id>` / `finalize:<id>`) is already present,
   * so repeat runs of this activity release nothing once the queue drains.
   *
   * @spec INV-BILLING-003 — reservation lifecycle: orphaned reservations
   * must be returned to the available balance so held funds never drift.
   */
  releaseStaleReservations: async (maxAgeSeconds: number): Promise<number> => {
    const program = Effect.gen(function* () {
      const creditService = yield* makeCreditService
      return yield* creditService.releaseStaleReservations(maxAgeSeconds)
    }).pipe(Effect.provide(CreditServiceDependenciesLive))

    const result = await runEffect(program)

    if (result.releasedCount > 0) {
      logger.warn('Released orphaned credit reservations.', {
        releasedCount: result.releasedCount,
        maxAgeSeconds
      })
    } else {
      logger.info('No stale credit reservations found.', { maxAgeSeconds })
    }

    return result.releasedCount
  },

  /**
   * Scan for failed auto-recharge attempts whose `next_retry_at` has
   * elapsed and re-fire `triggerAutoRecharge` for each one. Driven by the
   * scheduled `autoRechargeRetryWorkflow` on an hourly cadence.
   *
   * Idempotency: `createRetryAttempt` clears `next_retry_at` atomically as
   * part of the insert, so concurrent scheduler runs collapse to a single
   * retry. The retry attempt carries `retried_from_attempt_id` back to the
   * original row so a second failure correctly maps to `permanent_failed`.
   *
   * @spec billing-and-pricing-design §"Auto-recharge retry policy"
   * @spec INV-BILLING-010 — billing consumers are idempotent.
   */
  processDueAutoRechargeRetries: async (): Promise<number> => {
    const due = await runEffect(
      autoRechargeAttemptsRepository.findDueRetries(new Date())
    )

    if (due.length === 0) {
      logger.info('No auto-recharge attempts are due for retry.')
      return 0
    }

    let retried = 0
    for (const original of due) {
      const created = await runEffect(
        autoRechargeAttemptsRepository.createRetryAttempt({
          organizationId: original.organizationId,
          amountDecimillicents: original.amountDecimillicents,
          retriedFromAttemptId: original.id
        })
      )
      if (!created || Option.isNone(created)) {
        logger.info('Auto-recharge retry already claimed by another scheduler run.', {
          originalAttemptId: original.id
        })
        continue
      }

      logger.warn('Re-firing auto-recharge after the 48 h retry window.', {
        organizationId: original.organizationId,
        originalAttemptId: original.id,
        retryAttemptId: created.value.id
      })

      // Re-enter the shared trigger helper. Because the new pending row
      // has `retried_from_attempt_id` set, the helper will read
      // `isRetry === true` and fall through to `markPermanentFailed` if
      // the second charge also fails. Passing (0, 0) skips the
      // threshold-guard short-circuit so the retry always re-attempts
      // the charge regardless of the current balance.
      await runAutoRechargeTrigger(original.organizationId, 0, 0)
      retried += 1
    }

    return retried
  },

  /**
   * Fan out a billing domain event to the notifications + email channels.
   * Called from every billing child workflow body. Idempotent per outbox
   * event id — a second invocation with the same event id collapses to a
   * no-op before touching either channel.
   *
   * @spec notifications-design §"Minimal-First Implementation Plan"
   * @spec INV-NOTIF-002 — idempotent per outbox event id
   * @spec INV-NOTIF-005 — email failures never block in-app creation
   */
  notifyBillingEvent: async (event: SerializedDomainEvent): Promise<{ createdNotification: boolean }> => {
    const { fanOutBillingEvent } = await import('./billing-notification-handler.js')
    const { BillingEmailPortLive: BillingEmailPortLiveImpl } = await import('./billing-email-port-live.js')
    // Compose BillingEmailPort on top of the already-mutable
    // EmailDeliveryPort layer so test overrides of the delivery port via
    // `_setBillingEmailPortForTest` also flow through to the billing port.
    const billingPortLayer = BillingEmailPortLiveImpl.pipe(Layer.provide(billingEmailLayer))
    const program = fanOutBillingEvent(event, { billingEmailLayer: billingPortLayer })
    return runEffect(program)
  },

  /**
   * Nightly storage overage reconciliation. Lists every organization whose
   * most-recent `storage_usage` period_end has elapsed, then invokes
   * {@link makeStorageBillingService} `reconcileMonthlyOverage` for each
   * candidate. The service itself is idempotent via a
   * `reconcile:<orgId>:<monthTag>` ledger reference, so repeated runs for
   * the same period never double-charge.
   *
   * Orgs with no overage (current_bytes <= plan limit) are silently skipped
   * by the service. Orgs whose current credit balance is insufficient to
   * cover the overage charge surface a ledger failure — we log it and
   * continue to the next org so one bad tenant can't stall the whole
   * nightly sweep.
   *
   * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
   * @spec INV-BILLING-010 — billing consumers are idempotent.
   */
  reconcileMonthlyStorageOverage: async (): Promise<{
    candidateCount: number
    chargedCount: number
    totalChargedDecimillicents: number
    errorCount: number
  }> => {
    const now = new Date()
    const orgIds = await runEffect(
      storageUsageRepository.listOrganizationIdsWithExpiredUsage(now)
    )

    if (orgIds.length === 0) {
      logger.info('Nightly storage reconciliation: no candidate orgs.')
      return {
        candidateCount: 0,
        chargedCount: 0,
        totalChargedDecimillicents: 0,
        errorCount: 0
      }
    }

    let chargedCount = 0
    let totalChargedDecimillicents = 0
    let errorCount = 0

    for (const orgId of orgIds) {
      const program = Effect.gen(function* () {
        const service = yield* makeStorageBillingService
        return yield* service.reconcileMonthlyOverage(orgId)
      }).pipe(Effect.provide(StorageBillingServiceDependenciesLive))

      try {
        const outcome = await runEffect(program)
        if (outcome.chargedDecimillicents > 0) {
          chargedCount += 1
          totalChargedDecimillicents += outcome.chargedDecimillicents
          logger.info('Storage overage charged.', {
            organizationId: orgId,
            overageBytes: outcome.overageBytes,
            chargedDecimillicents: outcome.chargedDecimillicents
          })
        }
      } catch (error: unknown) {
        errorCount += 1
        logger.warn('Storage reconciliation failed for org — continuing.', {
          organizationId: orgId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    logger.info('Nightly storage reconciliation complete.', {
      candidateCount: orgIds.length,
      chargedCount,
      totalChargedDecimillicents,
      errorCount
    })

    return {
      candidateCount: orgIds.length,
      chargedCount,
      totalChargedDecimillicents,
      errorCount
    }
  }
}

export type BillingActivities = typeof billingActivities
