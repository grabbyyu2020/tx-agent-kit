import { sql } from 'drizzle-orm'
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex
} from 'drizzle-orm/pg-core'
import type { JsonObject } from './json.js'
import { organizations } from './organizations.js'

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  amountDecimillicents: bigint('amount_decimillicents', { mode: 'number' }).notNull(),
  entryType: text('entry_type').notNull().default('adjustment'),
  reason: text('reason').notNull(),
  referenceId: text('reference_id'),
  stripeEventId: text('stripe_event_id'),
  assetId: uuid('asset_id'),
  phase: text('phase'),
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('credit_ledger_org_created_at_idx').on(table.organizationId, table.createdAt),
  index('credit_ledger_reference_id_idx').on(table.referenceId),
  uniqueIndex('credit_ledger_stripe_event_id_unique_idx')
    .on(table.stripeEventId)
    .where(sql`${table.stripeEventId} IS NOT NULL`)
])

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  unitCostDecimillicents: bigint('unit_cost_decimillicents', { mode: 'number' }).notNull(),
  totalCostDecimillicents: bigint('total_cost_decimillicents', { mode: 'number' }).notNull(),
  // Stored as basis points: 1100 = 1.10x margin. BIGINT avoids float truncation.
  marginMultiplier: bigint('margin_multiplier', { mode: 'number' }),
  referenceId: text('reference_id'),
  assetId: uuid('asset_id'),
  stripeUsageRecordId: text('stripe_usage_record_id'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('usage_records_org_category_recorded_at_idx').on(
    table.organizationId,
    table.category,
    table.recordedAt
  ),
  index('usage_records_org_recorded_at_idx').on(table.organizationId, table.recordedAt),
  uniqueIndex('usage_records_org_reference_id_unique_idx')
    .on(table.organizationId, table.referenceId)
    .where(sql`${table.referenceId} IS NOT NULL`),
  index('usage_records_reference_id_idx').on(table.referenceId)
])

export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  stripeEventId: text('stripe_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  payload: jsonb('payload').$type<JsonObject>().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('subscription_events_org_created_at_idx').on(table.organizationId, table.createdAt),
  index('subscription_events_event_type_created_at_idx').on(table.eventType, table.createdAt),
  index('subscription_events_unprocessed_idx')
    .on(table.createdAt)
    .where(sql`processed_at IS NULL`)
])

export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow()
})

export const monthlyCreditsUsage = pgTable('monthly_credits_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  creditsUsed: bigint('credits_used', { mode: 'number' }).notNull().default(0),
  planTier: text('plan_tier'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('monthly_credits_usage_org_period_unique').on(table.orgId, table.periodStart),
  index('monthly_credits_usage_org_id_idx').on(table.orgId)
])

export const storageUsage = pgTable('storage_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  currentBytes: bigint('current_bytes', { mode: 'number' }).notNull().default(0),
  planStorageLimit: bigint('plan_storage_limit', { mode: 'number' }).notNull(),
  planTier: text('plan_tier'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('storage_usage_org_period_unique').on(table.orgId, table.periodStart),
  index('storage_usage_org_id_idx').on(table.orgId)
])

export const autoRechargeAttempts = pgTable('auto_recharge_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  amountDecimillicents: bigint('amount_decimillicents', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('pending'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  failureReason: text('failure_reason'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  retriedFromAttemptId: uuid('retried_from_attempt_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, (table) => [
  index('auto_recharge_attempts_org_id_idx').on(table.organizationId),
  index('auto_recharge_attempts_status_idx').on(table.status),
  index('auto_recharge_attempts_next_retry_at_partial_idx')
    .on(table.nextRetryAt)
    .where(sql`${table.nextRetryAt} IS NOT NULL`),
  // At most one pending attempt per org. Serialises the check-then-insert
  // race in runAutoRechargeTrigger so concurrent credits_low_balance events
  // collapse to a single charge. @spec INV-BILLING-010
  uniqueIndex('auto_recharge_attempts_one_pending_per_org_uniq_idx')
    .on(table.organizationId)
    .where(sql`${table.status} = 'pending'`)
])

export type CreditLedgerRow = typeof creditLedger.$inferSelect
export type UsageRecordRow = typeof usageRecords.$inferSelect
export type SubscriptionEventRow = typeof subscriptionEvents.$inferSelect
