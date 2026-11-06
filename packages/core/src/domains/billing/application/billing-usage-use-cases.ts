import { type Context, Effect, Option } from 'effect'
import { badRequest, internalError, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  isSubscriptionActive,
  isSubscriptionGuardSatisfied,
  type RecordUsageCommand,
  type UsageRecord
} from '../domain/billing-domain.js'
import { BillingGuardPort, BillingStorePort, ClockPort, UsageStorePort } from '../ports/billing-ports.js'
import type { BillingService } from './billing-service.js'
import {
  assertBillingAccess,
  isPositiveSafeInteger,
  isSafeNonNegativeInteger,
  toCoreInternal
} from './billing-use-case-support.js'

type BillingServiceShape = Context.Tag.Service<typeof BillingService>

/**
 * Top-level helper that exercises the recordUsage path (subscription
 * guard → idempotency lookup → immutable local usage record).
 * Lifted out of the `BillingServiceLive` object literal so both
 * `recordUsage` and `recordUsageFromCostResult` can call it without a
 * circular self-reference inside the literal initializer.
 *
 * The helper takes the same `RecordUsageCommand` shape as the public
 * `recordUsage` method and returns the same Effect, so wrapping it is
 * a single property assignment.
 */
const runRecordUsageEffect = (
  input: RecordUsageCommand
): Effect.Effect<
  UsageRecord,
  CoreError,
  BillingStorePort | UsageStorePort | BillingGuardPort | ClockPort
> =>
  Effect.gen(function* () {
    const billingStore = yield* BillingStorePort
    const usageStore = yield* UsageStorePort
    const guard = yield* BillingGuardPort
    const clock = yield* ClockPort

    // Defensive validation at the service seam. The public
    // `recordUsageInputSchema` pins these at the HTTP boundary, but
    // `recordUsageFromCostResult` (and any future direct core caller)
    // bypasses the schema, so pin again here. NaN/Infinity slip
    // through naive `< 1` / `< 0` comparisons because NaN < X is
    // always false — a poisoned input would reach usage_records and
    // corrupt the monthly cap increment downstream.
    if (!isPositiveSafeInteger(input.quantity)) {
      return yield* Effect.fail(badRequest(
        `recordUsage: quantity must be a positive integer <= Number.MAX_SAFE_INTEGER, got ${String(input.quantity)}`
      ))
    }
    if (!isSafeNonNegativeInteger(input.unitCostDecimillicents)) {
      return yield* Effect.fail(badRequest(
        `recordUsage: unitCostDecimillicents must be a non-negative integer <= Number.MAX_SAFE_INTEGER, got ${String(input.unitCostDecimillicents)}`
      ))
    }
    // Overflow guard: quantity * unitCost is a plain Number
    // multiplication, so for very large token counts (quantity in
    // the millions) paired with a non-trivial unit cost the product
    // could exceed Number.MAX_SAFE_INTEGER and silently round. Use
    // BigInt to detect overflow before it lands on the bigint column
    // as a truncated float.
    const totalCostBigInt = BigInt(input.quantity) * BigInt(input.unitCostDecimillicents)
    if (totalCostBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return yield* Effect.fail(badRequest(
        `recordUsage: quantity * unitCostDecimillicents exceeds MAX_SAFE_INTEGER (${totalCostBigInt.toString()})`
      ))
    }

    const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
      Effect.mapError(toCoreInternal('Failed to fetch billing settings')),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(notFound('Organization not found')),
        onSome: Effect.succeed
      }))
    )

    const guardEnabled = yield* guard.isEnabled()
    if (!isSubscriptionGuardSatisfied(
      { subscriptionStatus: settings.subscriptionStatus, isSubscribed: settings.isSubscribed },
      guardEnabled
    )) {
      return yield* Effect.fail(unauthorized('Active subscription required'))
    }

    if (input.referenceId) {
      const existingOpt = yield* usageStore.findByReferenceId(input.organizationId, input.referenceId).pipe(
        Effect.mapError(toCoreInternal('Failed to look up usage reference'))
      )

      if (Option.isSome(existingOpt)) {
        return existingOpt.value
      }
    }

    // Safe because the BigInt overflow guard above asserted the
    // product fits in Number.MAX_SAFE_INTEGER.
    const totalCostDecimillicents = Number(totalCostBigInt)
    const recordedAt = yield* clock.now()

    const recorded = yield* usageStore.record({
      organizationId: input.organizationId,
      category: input.category,
      quantity: input.quantity,
      unitCostDecimillicents: input.unitCostDecimillicents,
      totalCostDecimillicents,
      referenceId: input.referenceId ?? null,
      stripeUsageRecordId: null,
      metadata: input.metadata ?? {},
      recordedAt
    }).pipe(
      Effect.mapError(toCoreInternal('Failed to record usage')),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(internalError('Failed to record usage')),
        onSome: Effect.succeed
      }))
    )

    return recorded
  })

export const billingUsageUseCases: Pick<
  BillingServiceShape,
  'recordUsage' | 'recordUsageFromCostResult' | 'getUsageSummary'
> = {
  recordUsage: runRecordUsageEffect,

  recordUsageFromCostResult: (input) =>
    // Delegate to the existing recordUsage path. quantity = 1 because
    // CostResult already represents one priced operation; the
    // marginCostInCreditsDecimillicents already has the spec'd 1.10x
    // markup baked in via integer basis points (INV-BILLING-006), so
    // the ledger never re-applies the margin.
    //
    // We store the raw CostResult under metadata.cost so the breakdown
    // is preserved on the usage_records row for downstream analytics.
    // Existing metadata fields from the caller are merged on top.
    runRecordUsageEffect({
      organizationId: input.organizationId,
      category: input.category,
      quantity: 1,
      unitCostDecimillicents: input.cost.marginCostInCreditsDecimillicents,
      referenceId: input.referenceId ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        cost: {
          name: input.cost.name,
          costInCreditsDecimillicents: input.cost.costInCreditsDecimillicents,
          marginCostInCreditsDecimillicents: input.cost.marginCostInCreditsDecimillicents
        }
      }
    }),

  getUsageSummary: (principal, input) =>
    Effect.gen(function* () {
      yield* assertBillingAccess(input.organizationId, principal, false)
      const billingStore = yield* BillingStorePort
      const usageStore = yield* UsageStorePort
      const guard = yield* BillingGuardPort

      const settings = yield* billingStore.getSubscriptionFields(input.organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch billing settings')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Organization not found')),
          onSome: Effect.succeed
        }))
      )

      const guardEnabled = yield* guard.isEnabled()
      if (guardEnabled && !isSubscriptionActive(settings.subscriptionStatus)) {
        return yield* Effect.fail(unauthorized('Active subscription required'))
      }

      const summary = yield* usageStore.summarizeForPeriod({
        organizationId: input.organizationId,
        category: input.category,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd
      }).pipe(Effect.mapError(toCoreInternal('Failed to summarize usage')))

      return {
        organizationId: input.organizationId,
        category: input.category,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        totalQuantity: summary.totalQuantity,
        totalCostDecimillicents: summary.totalCostDecimillicents
      }
    })
}
