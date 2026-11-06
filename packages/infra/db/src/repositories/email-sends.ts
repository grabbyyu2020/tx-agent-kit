import { and, count, eq, inArray, lt, sql } from 'drizzle-orm'
import type { EmailSendStatus } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { DB, provideDB } from '../client.js'
import { emailSendRowSchema } from '../effect-schemas/email-sends.js'
import { toDbError } from '../errors.js'
import {
  emailCampaignSteps,
  emailCampaignEnrollments,
  emailSends,
  type JsonObject
} from '../schema.js'
import { createNullableDecoder, parseCountValue } from './sql-helpers.js'

// ---------------------------------------------------------------------------
// Effect schema decoders — validate DB rows at runtime boundaries
// ---------------------------------------------------------------------------

const decodeNullableSend = createNullableDecoder(emailSendRowSchema, 'email send row')

export { decodeNullableSend }

// ---------------------------------------------------------------------------
// Row-to-domain mapping helpers
// ---------------------------------------------------------------------------

type EmailSendRow = typeof emailSends.$inferSelect

const toEmailSendRecord = (row: EmailSendRow) => ({
  id: row.id,
  enrollmentId: row.enrollmentId,
  stepId: row.stepId,
  campaignId: row.campaignId,
  userId: row.userId,
  toEmail: row.toEmail,
  status: row.status,
  resendMessageId: row.resendMessageId,
  sentAt: row.sentAt,
  deliveredAt: row.deliveredAt,
  openedAt: row.openedAt,
  clickedAt: row.clickedAt,
  bouncedAt: row.bouncedAt,
  complainedAt: row.complainedAt,
  failedReason: row.failedReason,
  metadata: row.metadata,
  createdAt: row.createdAt
})

// ---------------------------------------------------------------------------
// emailSendRepository
// ---------------------------------------------------------------------------

export const emailSendRepository = {
  create: (input: {
    enrollmentId?: string | null
    stepId: string
    campaignId: string
    userId: string
    toEmail: string
    resendMessageId?: string | null
    metadata?: unknown
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailSends)
          .values({
            enrollmentId: input.enrollmentId ?? null,
            stepId: input.stepId,
            campaignId: input.campaignId,
            userId: input.userId,
            toEmail: input.toEmail,
            resendMessageId: input.resendMessageId ?? null,
            metadata: (input.metadata ?? {}) as JsonObject
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toEmailSendRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create email send', error))),

  /**
   * Idempotent drip-send slot in one round-trip: insert the (enrollment, step)
   * send row if absent, else return the existing row untouched (its real status
   * included, so the caller can skip an already-sent step). Backed by the
   * partial-unique idx_email_sends_enrollment_step_unique, so two concurrent
   * render-and-send retries converge on a single row instead of racing two
   * inserts. Replaces the separate findByEnrollmentAndStep + create. Drip only:
   * enrollmentId is required; broadcast sends (null enrollment_id) use create().
   */
  upsertDripSend: (input: {
    enrollmentId: string
    stepId: string
    campaignId: string
    userId: string
    toEmail: string
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailSends)
          .values({
            enrollmentId: input.enrollmentId,
            stepId: input.stepId,
            campaignId: input.campaignId,
            userId: input.userId,
            toEmail: input.toEmail
          })
          .onConflictDoUpdate({
            target: [emailSends.enrollmentId, emailSends.stepId],
            targetWhere: sql`${emailSends.enrollmentId} IS NOT NULL`,
            // No-op self-assign: DO NOTHING returns no rows on conflict, so we
            // touch nothing-meaningful purely to make the existing row RETURNable.
            // The existing status/timestamps are deliberately left untouched.
            set: { enrollmentId: sql`${emailSends.enrollmentId}` }
          })
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to upsert drip send', error))),

  findByResendMessageId: (resendMessageId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailSends)
          .where(eq(emailSends.resendMessageId, resendMessageId))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find email send by resend message id', error))),

  findByEnrollmentAndStep: (enrollmentId: string, stepId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailSends)
          .where(
            and(
              eq(emailSends.enrollmentId, enrollmentId),
              eq(emailSends.stepId, stepId)
            )
          )
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find email send by enrollment and step', error))),

  updateStatus: (
    id: string,
    status: EmailSendStatus,
    timestamps: {
      sentAt?: Date | null
      deliveredAt?: Date | null
      openedAt?: Date | null
      clickedAt?: Date | null
      bouncedAt?: Date | null
      complainedAt?: Date | null
      failedReason?: string | null
      resendMessageId?: string | null
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { status }

        if (timestamps.sentAt !== undefined) { patch.sentAt = timestamps.sentAt }
        if (timestamps.deliveredAt !== undefined) { patch.deliveredAt = timestamps.deliveredAt }
        if (timestamps.openedAt !== undefined) { patch.openedAt = timestamps.openedAt }
        if (timestamps.clickedAt !== undefined) { patch.clickedAt = timestamps.clickedAt }
        if (timestamps.bouncedAt !== undefined) { patch.bouncedAt = timestamps.bouncedAt }
        if (timestamps.complainedAt !== undefined) { patch.complainedAt = timestamps.complainedAt }
        if (timestamps.failedReason !== undefined) { patch.failedReason = timestamps.failedReason }
        if (timestamps.resendMessageId !== undefined) { patch.resendMessageId = timestamps.resendMessageId }

        const rows = yield* db
          .update(emailSends)
          .set(patch)
          .where(eq(emailSends.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEmailSendRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update email send status', error))),

  aggregateByCampaign: (campaignId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const enrollmentRows = yield* db
          .select({
            total: count(),
            active: sql<number>`count(*) filter (where ${emailCampaignEnrollments.status} = 'active')`,
            completed: sql<number>`count(*) filter (where ${emailCampaignEnrollments.status} = 'completed')`,
            cancelled: sql<number>`count(*) filter (where ${emailCampaignEnrollments.status} = 'cancelled')`
          })
          .from(emailCampaignEnrollments)
          .where(eq(emailCampaignEnrollments.campaignId, campaignId))
          .execute()

        const sendRows = yield* db
          .select({
            total: count(),
            delivered: sql<number>`count(*) filter (where ${emailSends.status} = 'delivered')`,
            opened: sql<number>`count(*) filter (where ${emailSends.status} = 'opened')`,
            clicked: sql<number>`count(*) filter (where ${emailSends.status} = 'clicked')`,
            bounced: sql<number>`count(*) filter (where ${emailSends.status} = 'bounced')`,
            complained: sql<number>`count(*) filter (where ${emailSends.status} = 'complained')`,
            failed: sql<number>`count(*) filter (where ${emailSends.status} = 'failed')`
          })
          .from(emailSends)
          .where(eq(emailSends.campaignId, campaignId))
          .execute()

        const enrollment = enrollmentRows[0]
        const send = sendRows[0]

        return {
          campaignId,
          totalEnrollments: parseCountValue(enrollment?.total),
          activeEnrollments: parseCountValue(enrollment?.active),
          completedEnrollments: parseCountValue(enrollment?.completed),
          cancelledEnrollments: parseCountValue(enrollment?.cancelled),
          totalSends: parseCountValue(send?.total),
          delivered: parseCountValue(send?.delivered),
          opened: parseCountValue(send?.opened),
          clicked: parseCountValue(send?.clicked),
          bounced: parseCountValue(send?.bounced),
          complained: parseCountValue(send?.complained),
          failed: parseCountValue(send?.failed)
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to aggregate campaign analytics', error))),

  aggregateByStep: (campaignId: string, stepId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const rows = yield* db
          .select({
            total: count(),
            delivered: sql<number>`count(*) filter (where ${emailSends.status} = 'delivered')`,
            opened: sql<number>`count(*) filter (where ${emailSends.status} = 'opened')`,
            clicked: sql<number>`count(*) filter (where ${emailSends.status} = 'clicked')`,
            bounced: sql<number>`count(*) filter (where ${emailSends.status} = 'bounced')`,
            complained: sql<number>`count(*) filter (where ${emailSends.status} = 'complained')`,
            failed: sql<number>`count(*) filter (where ${emailSends.status} = 'failed')`
          })
          .from(emailSends)
          .where(
            and(
              eq(emailSends.campaignId, campaignId),
              eq(emailSends.stepId, stepId)
            )
          )
          .execute()

        const row = rows[0]

        return {
          stepId,
          campaignId,
          totalSends: parseCountValue(row?.total),
          delivered: parseCountValue(row?.delivered),
          opened: parseCountValue(row?.opened),
          clicked: parseCountValue(row?.clicked),
          bounced: parseCountValue(row?.bounced),
          complained: parseCountValue(row?.complained),
          failed: parseCountValue(row?.failed)
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to aggregate step analytics', error))),

  pruneOlderThan: (cutoffDate: Date) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(emailSends)
          .where(
            and(
              lt(emailSends.createdAt, cutoffDate),
              inArray(emailSends.status, ['delivered', 'opened', 'clicked'])
            )
          )
          .returning({ id: emailSends.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to prune old email sends', error))),

  /**
   * Delete every send row for an enrollment. Used when a terminal enrollment is
   * re-enrolled in place (the (campaign,user) row id is reused): the prior
   * cycle's `sent` rows would otherwise satisfy the per-(enrollment,step)
   * idempotency check in `renderAndSendEmail` and silently suppress the new
   * cycle's emails. email_sends has a retention policy (it is not a financial
   * audit trail), so clearing a re-enrolled cycle's rows is safe.
   */
  deleteByEnrollment: (enrollmentId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .delete(emailSends)
          .where(eq(emailSends.enrollmentId, enrollmentId))
          .returning({ id: emailSends.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete email sends for enrollment', error))),

  /**
   * True when the user has clicked the CTA of any prior feedback-ask email
   * (a send whose step's templateId is one of `feedbackTemplateIds` and whose
   * row has a non-null `clicked_at`). Backs the `has_not_left_feedback` audience
   * predicate: "left feedback" = clicked a feedback email's CTA, so the engine
   * suppresses re-asking. Joins email_sends -> email_campaign_steps by step id.
   */
  hasClickedFeedbackEmail: (userId: string, feedbackTemplateIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (feedbackTemplateIds.length === 0) {
          return false
        }
        const rows = yield* db
          .select({ id: emailSends.id })
          .from(emailSends)
          .innerJoin(emailCampaignSteps, eq(emailCampaignSteps.id, emailSends.stepId))
          .where(
            and(
              eq(emailSends.userId, userId),
              sql`${emailSends.clickedAt} IS NOT NULL`,
              inArray(emailCampaignSteps.templateId, [...feedbackTemplateIds])
            )
          )
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check feedback-email click', error)))
}
