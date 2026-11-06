import { createLogger } from '@tx-agent-kit/logging'
import {
  autoRechargeAttemptsRepository,
  getPool,
  organizationsRepository
} from '@tx-agent-kit/db'
import {
  AutoRechargeAttemptStorePortLive,
  BillingService,
  BillingServiceLive,
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  CreditServicePort,
  makeCreditService,
  type StripePort
} from '@tx-agent-kit/core'
import { makeWorkerStripePortLive } from '@tx-agent-kit/stripe'
import { Effect, Layer, Option } from 'effect'
import { getWorkerStripeSecretKey } from './config/env.js'

const logger = createLogger('tx-agent-kit-worker-billing-activities')

/**
 * Delay between a first auto-recharge failure and the one retry attempt.
 * @spec billing-and-pricing-design §"Auto-recharge retry policy"
 */
const AUTO_RECHARGE_RETRY_DELAY_MS = 48 * 60 * 60 * 1000

interface AutoRechargeAttemptLock {
  readonly release: () => Promise<void>
}

const tryAcquireAutoRechargeAttemptLock = async (
  attemptId: string
): Promise<AutoRechargeAttemptLock | null> => {
  const lockName = `auto-recharge-attempt:${attemptId}`
  const client = await getPool().connect()
  let released = false

  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockName]
    )
    if (result.rows[0]?.acquired !== true) {
      client.release()
      return null
    }

    return {
      release: async () => {
        if (released) {
          return
        }
        released = true
        try {
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [lockName]
          )
        } finally {
          client.release()
        }
      }
    }
  } catch (error) {
    client.release()
    throw error
  }
}

const failLatestPendingAutoRechargeAttempt = async (
  orgId: string,
  reason: string
): Promise<void> => {
  const pending = await runEffect(
    autoRechargeAttemptsRepository.findLatestPendingForOrganization(orgId)
  )
  const latest = pending[0] ?? null
  if (!latest) {
    return
  }

  await runEffect(
    autoRechargeAttemptsRepository.markFailed(latest.id, reason)
  )
}

/**
 * Top-level helper that exercises the auto-recharge flow for an org. Lifted
 * out of the activity object so that both the `triggerAutoRecharge`
 * activity and the `processDueAutoRechargeRetries` scheduler can call it
 * without a circular self-reference inside the activities const.
 */
export const runAutoRechargeTrigger = async (
  orgId: string,
  currentBalanceDecimillicents: number,
  thresholdDecimillicents: number
): Promise<void> => {
  const org = await runEffect(organizationsRepository.getById(orgId))
  if (Option.isNone(org)) {
    logger.warn('Auto-recharge trigger: organization not found.', { orgId })
    return
  }

  const skipThresholdGuard = currentBalanceDecimillicents === 0 && thresholdDecimillicents === 0
  if (!org.value.autoRechargeEnabled) {
    logger.info('Auto-recharge trigger skipped: auto-recharge is disabled.', { orgId })
    if (skipThresholdGuard) {
      await failLatestPendingAutoRechargeAttempt(orgId, 'auto-recharge disabled')
    }
    return
  }

  const amount = org.value.autoRechargeAmount ?? 0
  if (amount <= 0) {
    logger.warn('Auto-recharge trigger skipped: no recharge amount configured.', { orgId })
    if (skipThresholdGuard) {
      await failLatestPendingAutoRechargeAttempt(orgId, 'no recharge amount configured')
    }
    return
  }

  // Idempotency guard: re-read the current available balance and short-
  // circuit if it is already above the threshold. The previous run of
  // this activity (or a manual top-up) may have already refilled the
  // account, so a second invocation for the same low-balance event
  // should be a no-op. The retry path passes (0, 0) so the guard is
  // skipped — the retry should always re-attempt the charge regardless
  // of the current threshold.
  const threshold = org.value.autoRechargeThreshold ?? 0
  const currentAvailable = org.value.creditsBalance - org.value.reservedCredits
  if (!skipThresholdGuard && threshold > 0 && currentAvailable >= threshold) {
    logger.info('Auto-recharge trigger skipped: balance already above threshold.', {
      orgId,
      currentAvailable,
      threshold
    })
    return
  }

  if (!skipThresholdGuard) {
    const unresolvedChallenge = await runEffect(
      autoRechargeAttemptsRepository.findLatestRequiresActionChallenge(orgId)
    )
    if (unresolvedChallenge) {
      logger.info('Auto-recharge trigger skipped: unresolved 3DS challenge already exists.', {
        orgId,
        attemptId: unresolvedChallenge.attemptId,
        stripePaymentIntentId: unresolvedChallenge.stripePaymentIntentId
      })
      return
    }
  }

  // Reuse the latest pending attempt if one is already in flight —
  // this makes Temporal retries of the same credits_low_balance event
  // land on the same attempt id (and therefore the same Stripe
  // idempotency key).
  const existing = await runEffect(
    autoRechargeAttemptsRepository.findLatestPendingForOrganization(orgId)
  )
  const existingAttempt = existing[0] ?? null

  let attemptId: string
  let isRetry: boolean
  if (existingAttempt) {
    attemptId = existingAttempt.id
    isRetry = existingAttempt.retriedFromAttemptId !== null
  } else {
    // Race-safe create: the partial unique index
    // `auto_recharge_attempts_one_pending_per_org_uniq_idx` guarantees
    // at most one pending row per org. On conflict `createPending`
    // returns None — fall through to a re-read and reuse the winning
    // concurrent insert's attempt id. @spec INV-BILLING-010
    const created = await runEffect(
      autoRechargeAttemptsRepository.createPending({
        organizationId: orgId,
        amountDecimillicents: amount
      })
    )
    if (Option.isSome(created)) {
      attemptId = created.value.id
      isRetry = false
    } else {
      const contested = await runEffect(
        autoRechargeAttemptsRepository.findLatestPendingForOrganization(orgId)
      )
      const winner = contested[0]
      if (!winner) {
        logger.error(
          'Auto-recharge trigger: createPending conflicted but no pending row found on re-read.',
          { orgId }
        )
        return
      }
      logger.info('Auto-recharge trigger: reusing concurrent winner pending attempt.', {
        orgId,
        attemptId: winner.id
      })
      attemptId = winner.id
      isRetry = winner.retriedFromAttemptId !== null
    }
  }

  const attemptLock = await tryAcquireAutoRechargeAttemptLock(attemptId)
  if (!attemptLock) {
    logger.info('Auto-recharge trigger skipped: attempt is already being charged by another worker.', {
      orgId,
      attemptId
    })
    return
  }

  try {
    const lockedAttempt = await runEffect(autoRechargeAttemptsRepository.findById(attemptId))
    if (Option.isNone(lockedAttempt) || lockedAttempt.value.status !== 'pending') {
      logger.info('Auto-recharge trigger skipped: attempt is no longer pending after lock acquisition.', {
        orgId,
        attemptId,
        status: Option.isSome(lockedAttempt) ? lockedAttempt.value.status : 'missing'
      })
      return
    }

    isRetry = lockedAttempt.value.retriedFromAttemptId !== null
    const chargeAttemptId = attemptId
    const program = Effect.gen(function* () {
      const billingService = yield* BillingService
      return yield* billingService.chargeAutoRecharge({
        organizationId: orgId,
        attemptId: chargeAttemptId,
        amountDecimillicents: amount
      })
    }).pipe(Effect.provide(BillingServiceRuntimeLive))

    const result = await Effect.runPromise(
      program.pipe(
        Effect.mapError((e) => {
          const message = e instanceof Error ? e.message : String(e)
          return new Error(message, { cause: e instanceof Error ? e : undefined })
        })
      )
    )

    logger.info('Auto-recharge trigger completed.', {
      orgId,
      currentBalanceDecimillicents,
      thresholdDecimillicents,
      amountDecimillicents: amount,
      attemptId,
      status: result.status,
      stripePaymentIntentId: result.stripePaymentIntentId,
      failureReason: result.failureReason,
      isRetry
    })

    // @spec billing-and-pricing-design §"Auto-recharge retry policy"
    // On a failure, branch on whether this attempt is itself a retry.
    // The first failure schedules one retry at T+48 h; the second
    // failure (i.e. the retry itself failed) marks the attempt
    // permanently failed so the org sees the invoice in their portal.
    if (result.status === 'failed') {
      if (isRetry) {
        await runEffect(
          autoRechargeAttemptsRepository.markPermanentFailed(
            attemptId,
            result.failureReason ?? 'card declined on retry'
          )
        )
        logger.error('Auto-recharge retry failed — attempt marked permanent_failed.', {
          organizationId: orgId,
          attemptId,
          failureReason: result.failureReason
        })
      } else {
        const nextRetryAt = new Date(Date.now() + AUTO_RECHARGE_RETRY_DELAY_MS)
        await runEffect(
          autoRechargeAttemptsRepository.scheduleRetry(attemptId, nextRetryAt)
        )
        logger.warn('Auto-recharge attempt failed — scheduled one retry at T+48 h.', {
          organizationId: orgId,
          attemptId,
          nextRetryAt: nextRetryAt.toISOString()
        })
      }
    }
  } catch (error) {
    // Never rethrow — the attempt row is the source of truth for state,
    // and Stripe idempotency on `attemptId` makes the scheduled retry safe
    // even if the first request reached Stripe but the worker did not
    // receive the response. Leaving the row `pending` here would strand
    // auto-recharge because the retry scheduler only scans failed rows.
    const failureReason = error instanceof Error && error.message.length > 0
      ? error.message
      : 'unexpected auto-recharge failure'
    logger.error(
      'Auto-recharge trigger crashed unexpectedly.',
      {
        orgId,
        attemptId,
        amountDecimillicents: amount,
        failureReason,
        isRetry
      },
      error instanceof Error ? error : new Error(String(error))
    )

    try {
      if (isRetry) {
        await runEffect(
          autoRechargeAttemptsRepository.markPermanentFailed(attemptId, failureReason)
        )
        logger.error('Auto-recharge retry crashed — attempt marked permanent_failed.', {
          organizationId: orgId,
          attemptId,
          failureReason
        })
      } else {
        const nextRetryAt = new Date(Date.now() + AUTO_RECHARGE_RETRY_DELAY_MS)
        await runEffect(
          autoRechargeAttemptsRepository.markFailed(attemptId, failureReason, null)
        )
        await runEffect(
          autoRechargeAttemptsRepository.scheduleRetry(attemptId, nextRetryAt)
        )
        logger.warn('Auto-recharge crash scheduled one retry at T+48 h.', {
          organizationId: orgId,
          attemptId,
          nextRetryAt: nextRetryAt.toISOString(),
          failureReason
        })
      }
    } catch (stateError) {
      logger.error(
        'Auto-recharge trigger could not persist crash recovery state.',
        {
          orgId,
          attemptId,
          failureReason
        },
        stateError instanceof Error ? stateError : new Error(String(stateError))
      )
    }
  } finally {
    await attemptLock.release()
  }
}

/**
 * Worker-side StripePort. The shared `@tx-agent-kit/stripe` package
 * owns the actual Stripe SDK wiring — this module just hands the factory
 * the worker's STRIPE_SECRET_KEY (resolved via the lightweight accessor
 * so test contexts without full worker env validation still resolve a
 * `null` stub cleanly).
 *
 * Only `createOffSessionPaymentIntent` is exercised from the worker; the
 * other methods `Effect.fail` with a descriptive error if ever called,
 * making a misrouted cross-process call surface as a recoverable activity
 * failure rather than a worker crash.
 *
 * The layer is built via `Layer.suspend` so the secret-key read happens
 * lazily the first time the adapter is actually provided — and tests can
 * swap the underlying factory via {@link _setBillingStripePortForTest}
 * to drive non-`succeeded` PaymentIntent statuses without a real Stripe
 * account.
 *
 * @spec billing-and-pricing-design
 */
let billingStripeLayerFactory: () => Layer.Layer<StripePort> = () =>
  makeWorkerStripePortLive({ secretKey: getWorkerStripeSecretKey() })

/**
 * Test hook: swap the worker-side StripePort factory so integration
 * tests can drive `requires_action` / `requires_payment_method` /
 * `canceled` PaymentIntent statuses without a live Stripe account.
 */
export const _setBillingStripePortForTest = (
  factory: () => Layer.Layer<StripePort>
): void => {
  billingStripeLayerFactory = factory
}

export const _resetBillingStripePortForTest = (): void => {
  billingStripeLayerFactory = () =>
    makeWorkerStripePortLive({ secretKey: getWorkerStripeSecretKey() })
}

const WorkerStripePortLive = Layer.suspend(() => billingStripeLayerFactory())

export const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

/**
 * Layer satisfying the ports that `makeCreditService` requires. The
 * `StaleReservationReaderPortLive` is already baked into `makeCreditService`
 * internally, so only billing store + credit ledger store need wiring here.
 *
 * @spec INV-BILLING-003
 */
export const CreditServiceDependenciesLive = Layer.mergeAll(
  BillingStorePortLive,
  CreditLedgerStorePortLive
)

/**
 * Layer providing the {@link CreditServicePort} to any Effect that needs
 * to run the auto-recharge loop via `BillingService.chargeAutoRecharge`.
 */
const CreditServicePortLive = Layer.effect(CreditServicePort, makeCreditService).pipe(
  Layer.provide(CreditServiceDependenciesLive)
)

/**
 * Full dependency graph for `BillingService.chargeAutoRecharge`. Provides
 * the billing service itself plus every port the service method relies on:
 * the billing store, credit service (ledger + outbox), auto-recharge
 * attempt store and the worker-side StripePort stub.
 *
 * @spec billing-and-pricing-design
 * @spec INV-BILLING-009
 */
const BillingServiceRuntimeLive = Layer.mergeAll(
  BillingServiceLive,
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  AutoRechargeAttemptStorePortLive,
  WorkerStripePortLive,
  CreditServicePortLive
)
