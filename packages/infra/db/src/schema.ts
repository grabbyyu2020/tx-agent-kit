import { sql } from 'drizzle-orm'
import {
  shadowingCaptionKinds,
  shadowingExplanationStatuses,
  shadowingFailureReasons,
  shadowingVideoStatuses,
  type ShadowingExplanation
} from '@tx-agent-kit/contracts'
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
import { users } from './schema/auth.js'
import { autoFixAgentKindEnum, autoFixRunStatusEnum } from './schema/enums.js'
import type { JsonObject } from './schema/json.js'
import { organizations } from './schema/organizations.js'

// The schema is split by aggregate into ./schema/*.ts; this file re-exports every
// module so `@tx-agent-kit/db` and drizzle-kit (drizzle.config.ts) keep a single
// entry point. Tables that nothing else references live here directly.
export type * from './schema/json.js'
export * from './schema/enums.js'
export * from './schema/auth.js'
export * from './schema/organizations.js'
export * from './schema/billing.js'
export * from './schema/platform.js'
export * from './schema/assets.js'
export * from './schema/email.js'

/**
 * Notifications — in-app notification feed + digest staging.
 *
 * Operational data (not a financial audit trail). Safe to delete on org
 * removal via ON DELETE CASCADE, and safe to prune on a retention policy.
 * Phase 1 scope is write + read + mark-read + unread-count only; digest
 * columns are present but idle until a future slice wires digest dispatch.
 *
 * @spec notifications-design §"Data Model"
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  readAt: timestamp('read_at', { withTimezone: true }),
  digestBatchId: uuid('digest_batch_id'),
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('notifications_user_org_created_at_idx')
    .on(table.userId, table.organizationId, table.createdAt),
  index('notifications_digest_batch_pending_idx')
    .on(table.digestBatchId)
    .where(sql`${table.digestBatchId} IS NOT NULL AND ${table.emailedAt} IS NULL`),
  index('notifications_org_event_type_created_at_idx')
    .on(table.organizationId, table.eventType, table.createdAt),
  uniqueIndex('notifications_outbox_event_id_user_org_uniq_idx')
    .on(table.userId, table.organizationId, sql`(${table.metadata}->>'outbox_event_id')`)
    .where(sql`${table.metadata}->>'outbox_event_id' IS NOT NULL`)
])

export type NotificationRow = typeof notifications.$inferSelect

// ── Auto-fix runs (operational infra, NOT a domain event) ────────────
//
// The API new-issue webhook inserts a row on a genuinely new issue and starts a
// Temporal workflow directly via the sanctioned adapter. The unique index on
// `sentry_issue_id` is both the once-per-issue guarantee and the webhook dedupe
// key (INSERT ... ON CONFLICT (sentry_issue_id) DO NOTHING). Agent-generic
// columns (no 'codex' in names) so the pluggable runner can be codex or claude.
export const autoFixRuns = pgTable('auto_fix_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  sentryIssueId: text('sentry_issue_id').notNull(),
  environment: text('environment').notNull(), // 'staging' | 'production'
  fingerprint: text('fingerprint'),
  title: text('title').notNull(),
  permalink: text('permalink'),
  status: autoFixRunStatusEnum('status').notNull().default('pending'),
  branch: text('branch'), // autofix/<sentry_issue_id>
  agent: autoFixAgentKindEnum('agent'), // 'codex' | 'claude' (null until the activity runs)
  agentOutput: jsonb('agent_output').$type<JsonObject | null>(), // structured AutoFixResult
  agentJsonlOutput: text('agent_jsonl_output'), // raw JSONL/stream output for audit
  prUrl: text('pr_url'),
  agentError: text('agent_error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('auto_fix_runs_sentry_issue_unique').on(table.sentryIssueId),
  index('auto_fix_runs_status_idx').on(table.status, table.createdAt),
  index('auto_fix_runs_environment_idx').on(table.environment)
])

export type AutoFixRunRow = typeof autoFixRuns.$inferSelect

// ── YouTube shadowing (per-user practice library) ────────────────────
//
// One row per (user, YouTube id). Sentences and segments are derived data that
// the import workflow replaces in one transaction; both cascade with the video.
// CHECK constraints (youtube id format, status ⇔ failure_reason, explanation
// status ⇔ explanation presence) live in migration 0057_shadowing.sql.
// Not covered by retention policies (NFR-040).
//
// @spec youtube-shadowing-design §"Data Model"
export const shadowingVideos = pgTable('shadowing_videos', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  youtubeVideoId: text('youtube_video_id').notNull(),
  title: text('title').notNull().default(''),
  thumbnailUrl: text('thumbnail_url'),
  durationSeconds: integer('duration_seconds'),
  captionKind: text('caption_kind', { enum: shadowingCaptionKinds }),
  status: text('status', { enum: shadowingVideoStatuses }).notNull().default('importing'),
  failureReason: text('failure_reason', { enum: shadowingFailureReasons }),
  failureMessage: text('failure_message'),
  sentenceCount: integer('sentence_count').notNull().default(0),
  lastSegmentIndex: integer('last_segment_index').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('shadowing_videos_user_youtube_unique').on(table.userId, table.youtubeVideoId),
  index('shadowing_videos_user_created_idx').on(table.userId, table.createdAt.desc())
])

export const shadowingSentences = pgTable('shadowing_sentences', {
  id: uuid('id').defaultRandom().primaryKey(),
  videoId: uuid('video_id').notNull().references(() => shadowingVideos.id, { onDelete: 'cascade' }),
  sentenceIndex: integer('sentence_index').notNull(),
  batchIndex: integer('batch_index').notNull(),
  text: text('text').notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
  explanation: jsonb('explanation').$type<ShadowingExplanation>(),
  explanationStatus: text('explanation_status', { enum: shadowingExplanationStatuses }).notNull().default('pending'),
  explanationRequestedAt: timestamp('explanation_requested_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('shadowing_sentences_video_index_unique').on(table.videoId, table.sentenceIndex),
  index('shadowing_sentences_pending_idx').on(table.videoId, table.explanationStatus, table.batchIndex)
])

export const shadowingSegments = pgTable('shadowing_segments', {
  id: uuid('id').defaultRandom().primaryKey(),
  videoId: uuid('video_id').notNull().references(() => shadowingVideos.id, { onDelete: 'cascade' }),
  sentenceId: uuid('sentence_id').notNull().references(() => shadowingSentences.id, { onDelete: 'cascade' }),
  segmentIndex: integer('segment_index').notNull(),
  sentenceIndex: integer('sentence_index').notNull(),
  text: text('text').notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull()
}, (table) => [
  uniqueIndex('shadowing_segments_video_index_unique').on(table.videoId, table.segmentIndex)
])

export type ShadowingVideoRow = typeof shadowingVideos.$inferSelect
export type ShadowingVideoInsert = typeof shadowingVideos.$inferInsert
export type ShadowingSentenceRow = typeof shadowingSentences.$inferSelect
export type ShadowingSentenceInsert = typeof shadowingSentences.$inferInsert
export type ShadowingSegmentRow = typeof shadowingSegments.$inferSelect
export type ShadowingSegmentInsert = typeof shadowingSegments.$inferInsert
