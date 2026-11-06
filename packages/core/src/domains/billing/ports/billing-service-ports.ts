import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { CoreError } from '../../../errors.js'
import type { JsonObject } from '../domain/billing-domain.js'

/**
 * Required by `scripts/lint/enforce-route-kind-contracts.mjs`. `custom`
 * marks these ports as bespoke service contracts rather than generic CRUD
 * repositories.
 */
export const BillingServicePortsRepositoryKind = 'custom' as const

export class UsageCapServicePort extends Context.Tag('UsageCapServicePort')<
  UsageCapServicePort,
  {
    checkUsageCaps: (input: {
      organizationId: string
      estimatedCostDecimillicents: number
      periodStart: Date
      periodEnd: Date
      planTier: string
    }) => Effect.Effect<
      {
        warningLevel: 'none' | 'warning_80' | 'warning_95' | 'exceeded'
        usageCapDecimillicents: number | null
        creditsUsedAfter: number
      },
      CoreError
    >
    /**
     * Atomic increment helper callers use AFTER a successful AI operation.
     *
     * @spec INV-BILLING-008
     */
    incrementMonthlyUsage: (input: {
      organizationId: string
      periodStart: Date
      periodEnd: Date
      deltaDecimillicents: number
      planTier: string | null
    }) => Effect.Effect<void, CoreError>
    /**
     * Atomic increment + transactional outbox emission on threshold
     * crossings. Callers use this AFTER a successful AI operation so the
     * counter update and the warning event commit together.
     *
     * @spec INV-BILLING-008
     * @spec INV-BILLING-009
     */
    incrementMonthlyUsageAndEmit: (input: {
      organizationId: string
      periodStart: Date
      periodEnd: Date
      deltaDecimillicents: number
      planTier: string | null
    }) => Effect.Effect<
      {
        previousCreditsUsed: number
        newCreditsUsed: number
        capDecimillicents: number | null
        emittedEventType: null | 'billing.usage_cap_warning' | 'billing.usage_cap_exceeded'
      },
      CoreError
    >
  }
>() {}

export class CreditServicePort extends Context.Tag('CreditServicePort')<
  CreditServicePort,
  {
    reserve: (input: {
      organizationId: string
      estimatedCostDecimillicents: number
      referenceId: string
      reason: string
    }) => Effect.Effect<{ reservationId: string; remainingBalance: number }, CoreError>
    finalize: (input: {
      organizationId: string
      reservationId: string
      estimatedCostDecimillicents: number
      actualCostDecimillicents: number
      marginMultiplier: number
      assetId?: string | null
      phase?: string | null
      metadata?: JsonObject
    }) => Effect.Effect<{ finalCostDecimillicents: number; remainingBalance: number }, CoreError>
    release: (input: {
      organizationId: string
      reservationId: string
      estimatedCostDecimillicents: number
      reason: string
    }) => Effect.Effect<{ releasedAmount: number; remainingBalance: number }, CoreError>
    getAvailableBalance: (
      organizationId: string
    ) => Effect.Effect<{ creditsBalance: number; reservedCredits: number; available: number }, CoreError>
    /**
     * Credit a purchase that was confirmed by Stripe. Atomically appends a
     * positive ledger row and emits `billing.credits_purchased` in the same
     * transaction.
     *
     * @spec INV-BILLING-009
     */
    creditsPurchased: (input: {
      organizationId: string
      amountDecimillicents: number
      stripeEventId: string
      referenceId: string
      reason: string
    }) => Effect.Effect<{ newBalance: number }, CoreError>
    /**
     * Credit an auto-recharge top-up confirmed by Stripe. Atomically appends
     * a positive ledger row and emits `billing.credits_recharged` in the
     * same transaction.
     *
     * @spec INV-BILLING-009
     */
    creditsRecharged: (input: {
      organizationId: string
      amountDecimillicents: number
      stripePaymentIntentId: string
      stripeEventId: string
      referenceId: string
      reason: string
    }) => Effect.Effect<{ newBalance: number }, CoreError>
    /**
     * Reclaim orphaned reservations older than `maxAgeSeconds`. Driven by a
     * scheduled Temporal workflow — see `releaseStaleReservationsWorkflow`.
     *
     * @spec INV-BILLING-003 — reservation lifecycle.
     */
    releaseStaleReservations: (
      maxAgeSeconds: number
    ) => Effect.Effect<{ releasedCount: number }, CoreError>
  }
>() {}

export class StorageBillingServicePort extends Context.Tag('StorageBillingServicePort')<
  StorageBillingServicePort,
  {
    preUploadCheck: (input: {
      organizationId: string
      fileSizeBytes: number
    }) => Effect.Effect<{ allowed: boolean; overageBytes: number; overageCostDecimillicents: number; reason?: string }, CoreError>
    chargeStorageOverage: (input: {
      organizationId: string
      overageBytes: number
      costDecimillicents: number
      referenceId: string
    }) => Effect.Effect<{ charged: boolean }, CoreError>
    reconcileMonthlyOverage: (
      organizationId: string
    ) => Effect.Effect<{ overageBytes: number; chargedDecimillicents: number }, CoreError>
  }
>() {}

export class StripeWebhookHandlerPort extends Context.Tag('StripeWebhookHandlerPort')<
  StripeWebhookHandlerPort,
  {
    handle: (
      rawBody: string,
      signature: string
    ) => Effect.Effect<{ processed: true; idempotent: boolean; eventId: string }, CoreError>
    handleDispute: (input: {
      eventId: string
      disputeStatus: 'created' | 'closed'
      outcome?: 'won' | 'lost'
      chargeAmountDecimillicents: number
      organizationId: string
    }) => Effect.Effect<void, CoreError>
  }
>() {}
