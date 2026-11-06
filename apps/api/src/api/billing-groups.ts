import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'
import {
  storageQuotaResponseSchema,
  storageUsageResponseSchema,
  autoRechargeRequiresActionChallengeSchema,
  billingSettingsSchema,
  completeLocalBillingSetupSchema,
  createCheckoutSessionSchema,
  createTopUpSessionSchema,
  createPortalSessionSchema,
  noCapReminderPreferenceSchema,
  sessionUrlResponseSchema,
  stripeWebhookResponseSchema,
  updateBillingSettingsSchema,
  usageQueryParamsSchema,
  usageSummarySchema,
  creditBalanceResponseSchema,
  creditEntryTypeSchema
} from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'
import { OrganizationIdParam } from './shared-schemas.js'

const BillingSettings = billingSettingsSchema
const UpdateBillingSettingsBody = updateBillingSettingsSchema
const CheckoutSessionBody = createCheckoutSessionSchema
const TopUpSessionBody = createTopUpSessionSchema
const PortalSessionBody = createPortalSessionSchema
const CompleteLocalBillingSetupBody = completeLocalBillingSetupSchema
const SessionUrlResponse = sessionUrlResponseSchema
const UsageQueryParams = usageQueryParamsSchema
const UsageSummaryResponse = usageSummarySchema
const NoCapReminderPreferenceResponse = noCapReminderPreferenceSchema
const AutoRechargeRequiresActionResponse = autoRechargeRequiresActionChallengeSchema
const StripeWebhookResponse = stripeWebhookResponseSchema

const CreditBalanceResponse = creditBalanceResponseSchema
const CreditHistoryItem = Schema.Struct({
  id: Schema.UUID,
  entryType: creditEntryTypeSchema,
  amountDecimillicents: Schema.Number,
  reason: Schema.String,
  referenceId: Schema.NullOr(Schema.String),
  balanceAfter: Schema.Number,
  createdAt: Schema.String
})
const CreditHistoryResponse = Schema.Struct({
  items: Schema.Array(CreditHistoryItem),
  cursor: Schema.NullOr(Schema.String),
  hasMore: Schema.Boolean
})
const CreditHistoryParams = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String)
})

const StorageUsageResponse = storageUsageResponseSchema
const StorageQuotaResponse = storageQuotaResponseSchema

export const BillingGroup = HttpApiGroup.make('billing')
  .add(
    HttpApiEndpoint.get('getBillingSettings')`/v1/organizations/${OrganizationIdParam}/billing`
      .addSuccess(BillingSettings)
  )
  .add(
    HttpApiEndpoint.patch('updateBillingSettings')`/v1/organizations/${OrganizationIdParam}/billing`
      .setPayload(UpdateBillingSettingsBody)
      .addSuccess(BillingSettings)
  )
  .add(
    HttpApiEndpoint.post('createCheckoutSession', '/v1/billing/checkout')
      .setPayload(CheckoutSessionBody)
      .addSuccess(SessionUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('createPortalSession', '/v1/billing/portal')
      .setPayload(PortalSessionBody)
      .addSuccess(SessionUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('createTopUpSession')`/v1/billing/${OrganizationIdParam}/top-up`
      .setPayload(TopUpSessionBody)
      .addSuccess(SessionUrlResponse)
  )
  .add(
    HttpApiEndpoint.post('completeLocalBillingSetup')`/v1/billing/${OrganizationIdParam}/dev/complete-local`
      .setPayload(CompleteLocalBillingSetupBody)
      .addSuccess(BillingSettings)
  )
  .add(
    HttpApiEndpoint.get('getUsageSummary')`/v1/organizations/${OrganizationIdParam}/usage`
      .setUrlParams(UsageQueryParams)
      .addSuccess(UsageSummaryResponse)
  )
  .add(
    HttpApiEndpoint.get('getCreditBalance')`/v1/billing/${OrganizationIdParam}/credits`
      .addSuccess(CreditBalanceResponse)
  )
  .add(
    HttpApiEndpoint.get('getCreditHistory')`/v1/billing/${OrganizationIdParam}/credits/history`
      .setUrlParams(CreditHistoryParams)
      .addSuccess(CreditHistoryResponse)
  )
  .add(
    HttpApiEndpoint.get('getNoCapReminder')`/v1/billing/${OrganizationIdParam}/no-cap-reminder`
      .addSuccess(NoCapReminderPreferenceResponse)
  )
  .add(
    HttpApiEndpoint.post('dismissNoCapReminder')`/v1/billing/${OrganizationIdParam}/no-cap-reminder/dismiss`
      .addSuccess(NoCapReminderPreferenceResponse)
  )
  .add(
    HttpApiEndpoint.get('getAutoRechargeRequiresAction')`/v1/billing/${OrganizationIdParam}/auto-recharge/requires-action`
      .addSuccess(AutoRechargeRequiresActionResponse)
  )
  .add(
    HttpApiEndpoint.post('stripeWebhook', '/v1/webhooks/stripe')
      .addSuccess(StripeWebhookResponse)
  )

export const StorageMeteringGroup = HttpApiGroup.make('storagemetering')
  .add(
    HttpApiEndpoint.get('getStorageUsage')`/v1/organizations/${OrganizationIdParam}/storage/usage`
      .addSuccess(StorageUsageResponse)
  )
  .add(
    HttpApiEndpoint.get('getStorageQuota')`/v1/organizations/${OrganizationIdParam}/storage/quota`
      .addSuccess(StorageQuotaResponse)
  )
