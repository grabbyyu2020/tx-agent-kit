import type { CostResult, UsageCategory } from '@tx-agent-kit/contracts'
import { Context, Effect, Layer } from 'effect'
import type { CoreError } from '../../../errors.js'
import type {
  AutoRechargeRequiresActionChallenge,
  NoCapReminderPreference,
  BillingSettings,
  CompleteLocalBillingSetupCommand,
  CreateCheckoutSessionCommand,
  CreatePortalSessionCommand,
  CreateTopUpSessionCommand,
  JsonObject,
  RecordUsageCommand,
  UpdateBillingSettingsCommand,
  UsageRecord,
  UsageSummary,
  UsageSummaryCommand
} from '../domain/billing-domain.js'
import type {
  AutoRechargeAttemptStorePort,
  BillingGuardPort,
  BillingStorePort,
  BillingUiPreferenceStorePort,
  ClockPort,
  CreditLedgerStorePort,
  CreditServicePort,
  ProcessedStripeEventStorePort,
  StripePort,
  SubscriptionEventStorePort,
  UsageStorePort
} from '../ports/billing-ports.js'
import { chargeAutoRecharge } from './billing-auto-recharge-use-case.js'
import { billingCheckoutUseCases } from './billing-checkout-use-cases.js'
import { billingSettingsUseCases } from './billing-settings-use-cases.js'
import { billingUsageUseCases } from './billing-usage-use-cases.js'
import { processWebhookEvent } from './billing-webhook-use-case.js'

export class BillingService extends Context.Tag('BillingService')<
  BillingService,
  {
    getBillingSettings: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<BillingSettings, CoreError, BillingStorePort>
    updateBillingSettings: (
      principal: { userId: string },
      organizationId: string,
      input: UpdateBillingSettingsCommand
    ) => Effect.Effect<BillingSettings, CoreError, BillingStorePort>
    getNoCapReminderPreference: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<NoCapReminderPreference, CoreError, BillingStorePort | BillingUiPreferenceStorePort>
    dismissNoCapReminder: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<NoCapReminderPreference, CoreError, BillingStorePort | BillingUiPreferenceStorePort>
    getAutoRechargeRequiresActionChallenge: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<
      AutoRechargeRequiresActionChallenge | null,
      CoreError,
      BillingStorePort | AutoRechargeAttemptStorePort
    >
    createCheckoutSession: (
      principal: { userId: string; email: string },
      input: CreateCheckoutSessionCommand
    ) => Effect.Effect<
      { id: string; url: string },
      CoreError,
      BillingStorePort | StripePort
    >
    completeLocalBillingSetup: (
      principal: { userId: string; email: string },
      organizationId: string,
      input: CompleteLocalBillingSetupCommand
    ) => Effect.Effect<
      BillingSettings,
      CoreError,
      BillingStorePort | CreditServicePort | ClockPort
    >
    createPortalSession: (
      principal: { userId: string },
      input: CreatePortalSessionCommand
    ) => Effect.Effect<
      { id: string; url: string },
      CoreError,
      BillingStorePort | StripePort
    >
    createTopUpSession: (
      principal: { userId: string; email: string },
      input: CreateTopUpSessionCommand
    ) => Effect.Effect<
      { id: string; url: string },
      CoreError,
      BillingStorePort | StripePort
    >
    processWebhookEvent: (
      rawBody: string,
      signature: string
    ) => Effect.Effect<
      { processed: true; idempotent: boolean; eventId: string },
      CoreError,
      | BillingStorePort
      | StripePort
      | SubscriptionEventStorePort
      | ClockPort
      | ProcessedStripeEventStorePort
      | CreditLedgerStorePort
      | CreditServicePort
      | AutoRechargeAttemptStorePort
    >
    recordUsage: (input: RecordUsageCommand) => Effect.Effect<
      UsageRecord,
      CoreError,
      BillingStorePort | UsageStorePort | BillingGuardPort | ClockPort
    >
    /**
     * Record a usage row from a {@link CostResult}. Maps the customer-facing
     * `marginCostInCreditsDecimillicents` (which already has the spec'd 1.10x
     * margin baked in via integer basis points) into
     * `unit_cost_decimillicents` with `quantity = 1`, then delegates to
     * {@link recordUsage} so the existing INV-BILLING-008 monthly cap
     * increment and immutable usage-record audit path still fire.
     *
     * Use this at every call site where the AI service holds an OpenRouter
     * `CostResult` — it eliminates the latent drift surface where callers
     * had to manually pull `marginCostInCreditsDecimillicents` out of the
     * cost object and pass it as an inline `unitCost` param.
     *
     * @spec billing-and-pricing-design §"Cost recording"
     * @spec INV-BILLING-006 — margin is applied at CostResult creation time.
     * @spec INV-BILLING-008 — usage records drive the monthly cap increment.
     */
    recordUsageFromCostResult: (input: {
      organizationId: string
      category: UsageCategory
      cost: CostResult
      referenceId?: string | null
      metadata?: JsonObject
    }) => Effect.Effect<
      UsageRecord,
      CoreError,
      BillingStorePort | UsageStorePort | BillingGuardPort | ClockPort
    >
    getUsageSummary: (
      principal: { userId: string },
      input: UsageSummaryCommand
    ) => Effect.Effect<UsageSummary, CoreError, BillingStorePort | UsageStorePort | BillingGuardPort>
    /**
     * Execute the off-session auto-recharge loop. Looks up the org's saved
     * Stripe customer + payment method, calls the StripePort's off-session
     * PaymentIntent with the attempt id as the idempotency key, updates the
     * `auto_recharge_attempts` row, and (on success) credits the ledger via
     * {@link CreditServicePort.creditsRecharged} which atomically emits the
     * `billing.credits_recharged` outbox event.
     *
     * Missing payment method is a normal failure (returns `status: 'failed'`)
     * — not an exception. Card declines and SCA requirements land as
     * `'failed'` / `'requires_action'` respectively.
     *
     * @spec billing-and-pricing-design
     * @spec INV-BILLING-009 — atomic ledger commit path via creditsRecharged.
     */
    chargeAutoRecharge: (input: {
      organizationId: string
      attemptId: string
      amountDecimillicents: number
    }) => Effect.Effect<
      {
        status: 'succeeded' | 'failed' | 'requires_action'
        stripePaymentIntentId: string
        failureReason: string | null
      },
      CoreError,
      BillingStorePort | StripePort | CreditServicePort | AutoRechargeAttemptStorePort
    >
  }
>() {}

// Use cases live in sibling modules grouped by responsibility; the key
// order below matches the original single-literal implementation.
export const BillingServiceLive = Layer.effect(
  BillingService,
  Effect.succeed({
    ...billingSettingsUseCases,
    ...billingCheckoutUseCases,
    processWebhookEvent,
    chargeAutoRecharge,
    ...billingUsageUseCases
  })
)
