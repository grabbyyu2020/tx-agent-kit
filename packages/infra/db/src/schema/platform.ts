import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex
} from 'drizzle-orm/pg-core'
import { domainEventStatusEnum } from './enums.js'
import type { JsonObject } from './json.js'

export const domainEvents = pgTable('domain_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  correlationId: uuid('correlation_id'),
  sequenceNumber: integer('sequence_number').notNull().default(1),
  status: domainEventStatusEnum('status').notNull().default('pending'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  processingAt: timestamp('processing_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('domain_events_pending_poller_idx')
    .on(table.occurredAt, table.id)
    .where(sql`${table.status} = 'pending'`),
  index('domain_events_stuck_processing_idx')
    .on(table.processingAt)
    .where(sql`${table.status} = 'processing'`),
  index('domain_events_prune_published_idx')
    .on(table.publishedAt)
    .where(sql`${table.status} = 'published'`),
  index('domain_events_prune_failed_idx')
    .on(table.failedAt)
    .where(sql`${table.status} = 'failed'`),
  index('domain_events_aggregate_stream_idx')
    .on(table.aggregateType, table.aggregateId),
  uniqueIndex('domain_events_aggregate_sequence_unique')
    .on(table.aggregateId, table.sequenceNumber)
])

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<JsonObject>().notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
})

export type DomainEventRow = typeof domainEvents.$inferSelect
export type SystemSettingRow = typeof systemSettings.$inferSelect
