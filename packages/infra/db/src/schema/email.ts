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
import { users } from './auth.js'
import {
  emailCampaignStatusEnum,
  emailCampaignTypeEnum,
  emailCancelReasonEnum,
  emailEnrollmentStatusEnum,
  emailSendStatusEnum,
  emailSourceSystemEnum,
  emailSuppressionReasonEnum
} from './enums.js'
import type { JsonObject } from './json.js'
import { teams } from './organizations.js'

export const emailCampaigns = pgTable('email_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  campaignType: emailCampaignTypeEnum('campaign_type').notNull(),
  status: emailCampaignStatusEnum('status').notNull().default('draft'),
  triggerConfig: jsonb('trigger_config').$type<JsonObject>(),
  audienceFilter: jsonb('audience_filter').$type<JsonObject>(),
  fromName: text('from_name'),
  replyTo: text('reply_to'),
  // Stable natural key for config-as-code sync; NULL = hand-created/unmanaged.
  slug: text('slug'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('idx_email_campaigns_status').on(table.status, table.createdAt.desc()),
  index('idx_email_campaigns_type').on(table.campaignType),
  index('idx_email_campaigns_trigger')
    .using('gin', table.triggerConfig)
    .where(sql`${table.status} = 'active'`),
  uniqueIndex('email_campaigns_slug_unique').on(table.slug).where(sql`slug IS NOT NULL`)
])

export const emailCampaignSteps = pgTable('email_campaign_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  subject: text('subject').notNull(),
  templateId: text('template_id').notNull(),
  templateData: jsonb('template_data').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  delaySeconds: integer('delay_seconds').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('email_campaign_steps_campaign_step_order_unique').on(table.campaignId, table.stepOrder),
  index('idx_email_campaign_steps_campaign').on(table.campaignId, table.stepOrder)
])

export const emailCampaignEnrollments = pgTable('email_campaign_enrollments', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: emailEnrollmentStatusEnum('status').notNull().default('active'),
  currentStepOrder: integer('current_step_order'),
  // Due-queue state: when the next step is due (NULL when paused/completed/cancelled).
  nextStepAt: timestamp('next_step_at', { withTimezone: true }),
  // Remaining delay captured at pause so resume recomputes next_step_at.
  pausedRemainingSecs: integer('paused_remaining_secs'),
  // Optional lease so an overrunning/parallel sweep cannot re-grab an in-flight row.
  sweepLeasedUntil: timestamp('sweep_leased_until', { withTimezone: true }),
  // Deprecated: drips no longer use a per-enrollment workflow. Kept nullable.
  temporalWorkflowId: text('temporal_workflow_id'),
  // Provenance: the source domain event that created/re-enrolled this row
  // (REQ-LIFECYCLE-051). Null for the manual enroll path. See migration 0056.
  triggerEventType: text('trigger_event_type'),
  triggerEventId: uuid('trigger_event_id'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: emailCancelReasonEnum('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('email_campaign_enrollments_campaign_user_unique').on(table.campaignId, table.userId),
  index('idx_email_campaign_enrollments_campaign').on(table.campaignId, table.status),
  index('idx_email_campaign_enrollments_user').on(table.userId, table.status),
  index('idx_email_campaign_enrollments_status').on(table.status, table.enrolledAt),
  // THE DUE QUEUE: only active + scheduled rows; paused/terminal rows are excluded
  // (status != active OR next_step_at IS NULL) so they impose zero per-tick cost.
  index('idx_email_campaign_enrollments_due')
    .on(table.nextStepAt)
    .where(sql`status = 'active' AND next_step_at IS NOT NULL`)
])

// Markers that make "first time" / "once per team" lifecycle events fire exactly
// once. feature_used inserts (user_id, milestone); the activity scan inserts
// (team_id, milestone). Permanent (no retention).
export const lifecycleMilestones = pgTable('lifecycle_milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  milestone: text('milestone').notNull(),
  reachedAt: timestamp('reached_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('lifecycle_milestones_user_unique').on(table.userId, table.milestone).where(sql`user_id IS NOT NULL`),
  uniqueIndex('lifecycle_milestones_team_unique').on(table.teamId, table.milestone).where(sql`team_id IS NOT NULL`)
])

export const emailSends = pgTable('email_sends', {
  id: uuid('id').defaultRandom().primaryKey(),
  enrollmentId: uuid('enrollment_id').references(() => emailCampaignEnrollments.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id').notNull().references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  stepId: uuid('step_id').notNull().references(() => emailCampaignSteps.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toEmail: text('to_email').notNull(),
  resendMessageId: text('resend_message_id'),
  status: emailSendStatusEnum('status').notNull().default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
  bouncedAt: timestamp('bounced_at', { withTimezone: true }),
  complainedAt: timestamp('complained_at', { withTimezone: true }),
  failedReason: text('failed_reason'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('idx_email_sends_resend_msg')
    .on(table.resendMessageId)
    .where(sql`${table.resendMessageId} IS NOT NULL`),
  index('idx_email_sends_campaign_step').on(table.campaignId, table.stepId, table.status),
  index('idx_email_sends_user').on(table.userId, table.createdAt.desc()),
  // Drip-send idempotency key. Partial UNIQUE (enrollment_id IS NOT NULL) so the
  // (enrollment, step) row is created at most once and the send can upsert; a
  // null enrollment_id (broadcast send) is exempt. See migration 0055.
  uniqueIndex('idx_email_sends_enrollment_step_unique')
    .on(table.enrollmentId, table.stepId)
    .where(sql`${table.enrollmentId} IS NOT NULL`),
  index('idx_email_sends_prune')
    .on(table.createdAt)
    .where(sql`${table.status} IN ('delivered', 'opened', 'clicked')`)
])

export const emailSuppressionList = pgTable('email_suppression_list', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  reason: emailSuppressionReasonEnum('reason').notNull(),
  sourceSystem: emailSourceSystemEnum('source_system').notNull(),
  sourceId: text('source_id'),
  suppressedAt: timestamp('suppressed_at', { withTimezone: true }).notNull().defaultNow(),
  liftedAt: timestamp('lifted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('idx_email_suppression_active')
    .on(sql`lower(${table.email})`)
    .where(sql`${table.liftedAt} IS NULL`),
  index('idx_email_suppression_email').on(sql`lower(${table.email})`)
])

export const emailUnsubscribes = pgTable('email_unsubscribes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').references(() => emailCampaigns.id, { onDelete: 'cascade' }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('email_unsubscribes_user_campaign_unique')
    .on(table.userId, table.campaignId)
    .where(sql`${table.campaignId} IS NOT NULL`),
  uniqueIndex('email_unsubscribes_user_global_unique')
    .on(table.userId)
    .where(sql`${table.campaignId} IS NULL`),
  index('idx_email_unsubscribes_user').on(table.userId)
])

export type EmailCampaignRow = typeof emailCampaigns.$inferSelect
export type EmailCampaignStepRow = typeof emailCampaignSteps.$inferSelect
export type EmailCampaignEnrollmentRow = typeof emailCampaignEnrollments.$inferSelect
export type EmailSendRow = typeof emailSends.$inferSelect
export type EmailSuppressionListRow = typeof emailSuppressionList.$inferSelect
export type EmailUnsubscribeRow = typeof emailUnsubscribes.$inferSelect
export type LifecycleMilestoneRow = typeof lifecycleMilestones.$inferSelect
