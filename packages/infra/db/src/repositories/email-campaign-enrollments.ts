import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import type { EmailCancelReason, EmailEnrollmentStatus } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { DB, provideDB } from '../client.js'
import { emailCampaignEnrollmentRowSchema } from '../effect-schemas/email-campaign-enrollments.js'
import { toDbError } from '../errors.js'
import { emailCampaigns, emailCampaignEnrollments } from '../schema.js'
import { createNullableDecoder } from './sql-helpers.js'

// ---------------------------------------------------------------------------
// Effect schema decoders — validate DB rows at runtime boundaries
// ---------------------------------------------------------------------------

const decodeNullableEnrollment = createNullableDecoder(emailCampaignEnrollmentRowSchema, 'email campaign enrollment row')

export { decodeNullableEnrollment }

// ---------------------------------------------------------------------------
// Row-to-domain mapping helpers
// ---------------------------------------------------------------------------

type EnrollmentRow = typeof emailCampaignEnrollments.$inferSelect

const toEnrollmentRecord = (row: EnrollmentRow) => ({
  id: row.id,
  campaignId: row.campaignId,
  userId: row.userId,
  status: row.status,
  currentStepOrder: row.currentStepOrder,
  nextStepAt: row.nextStepAt,
  pausedRemainingSecs: row.pausedRemainingSecs,
  sweepLeasedUntil: row.sweepLeasedUntil,
  cancelReason: row.cancelReason,
  temporalWorkflowId: row.temporalWorkflowId,
  triggerEventType: row.triggerEventType,
  triggerEventId: row.triggerEventId,
  enrolledAt: row.enrolledAt,
  completedAt: row.completedAt,
  cancelledAt: row.cancelledAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

// ---------------------------------------------------------------------------
// enrollmentRepository
// ---------------------------------------------------------------------------

export const enrollmentRepository = {
  create: (input: {
    campaignId: string
    userId: string
    temporalWorkflowId?: string | null
    nextStepAt?: Date | null
    triggerEventType?: string | null
    triggerEventId?: string | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailCampaignEnrollments)
          .values({
            campaignId: input.campaignId,
            userId: input.userId,
            temporalWorkflowId: input.temporalWorkflowId ?? null,
            nextStepAt: input.nextStepAt ?? null,
            triggerEventType: input.triggerEventType ?? null,
            triggerEventId: input.triggerEventId ?? null
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toEnrollmentRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create enrollment', error))),

  findById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignEnrollments)
          .where(eq(emailCampaignEnrollments.id, id))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch enrollment by id', error))),

  findByCampaignAndUser: (campaignId: string, userId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignEnrollments)
          .where(
            and(
              eq(emailCampaignEnrollments.campaignId, campaignId),
              eq(emailCampaignEnrollments.userId, userId)
            )
          )
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find enrollment by campaign and user', error))),

  findManyByCampaign: (campaignId: string, filter?: { status?: EmailEnrollmentStatus }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const predicates: SQL[] = [eq(emailCampaignEnrollments.campaignId, campaignId)]

        if (filter?.status) {
          predicates.push(eq(emailCampaignEnrollments.status, filter.status))
        }

        const rows = yield* db
          .select()
          .from(emailCampaignEnrollments)
          .where(and(...predicates))
          .orderBy(asc(emailCampaignEnrollments.enrolledAt))
          .execute()

        return rows.map(toEnrollmentRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list enrollments for campaign', error))),

  updateById: (
    id: string,
    input: {
      status?: EmailEnrollmentStatus
      currentStepOrder?: number | null
      nextStepAt?: Date | null
      pausedRemainingSecs?: number | null
      sweepLeasedUntil?: Date | null
      cancelReason?: EmailCancelReason | null
      temporalWorkflowId?: string | null
      triggerEventType?: string | null
      triggerEventId?: string | null
      enrolledAt?: Date | null
      completedAt?: Date | null
      cancelledAt?: Date | null
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()` }

        if (input.status !== undefined) { patch.status = input.status }
        if (input.currentStepOrder !== undefined) { patch.currentStepOrder = input.currentStepOrder }
        if (input.nextStepAt !== undefined) { patch.nextStepAt = input.nextStepAt }
        if (input.pausedRemainingSecs !== undefined) { patch.pausedRemainingSecs = input.pausedRemainingSecs }
        if (input.sweepLeasedUntil !== undefined) { patch.sweepLeasedUntil = input.sweepLeasedUntil }
        if (input.cancelReason !== undefined) { patch.cancelReason = input.cancelReason }
        if (input.temporalWorkflowId !== undefined) { patch.temporalWorkflowId = input.temporalWorkflowId }
        if (input.triggerEventType !== undefined) { patch.triggerEventType = input.triggerEventType }
        if (input.triggerEventId !== undefined) { patch.triggerEventId = input.triggerEventId }
        if (input.enrolledAt !== undefined) { patch.enrolledAt = input.enrolledAt }
        if (input.completedAt !== undefined) { patch.completedAt = input.completedAt }
        if (input.cancelledAt !== undefined) { patch.cancelledAt = input.cancelledAt }

        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set(patch)
          .where(eq(emailCampaignEnrollments.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update enrollment', error))),

  /**
   * Claim due enrollments for the sweep: active rows whose next_step_at is due
   * and not currently leased, locked with FOR UPDATE SKIP LOCKED and stamped
   * with a lease so a parallel/overrunning sweep cannot re-grab them.
   */
  claimDue: (now: Date, limit: number, leaseUntil: Date) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        return yield* db.transaction((trx) =>
          Effect.gen(function* () {
            const due = yield* trx
              .select({ id: emailCampaignEnrollments.id })
              .from(emailCampaignEnrollments)
              .where(
                and(
                  eq(emailCampaignEnrollments.status, 'active'),
                  // The campaign itself must still be active: pausing/archiving a
                  // campaign must stop sending to its in-flight enrollments, but
                  // the enrollment rows stay status='active' (a campaign pause is
                  // not an enrollment cancel), so the sweep would otherwise keep
                  // delivering. A subquery (not a join) keeps FOR UPDATE SKIP
                  // LOCKED locking only the enrollment rows. Resume re-includes them.
                  sql`${emailCampaignEnrollments.campaignId} IN (SELECT ${emailCampaigns.id} FROM ${emailCampaigns} WHERE ${emailCampaigns.status} = 'active')`,
                  lte(emailCampaignEnrollments.nextStepAt, now),
                  or(
                    isNull(emailCampaignEnrollments.sweepLeasedUntil),
                    lt(emailCampaignEnrollments.sweepLeasedUntil, now)
                  )
                )
              )
              .orderBy(asc(emailCampaignEnrollments.nextStepAt))
              .limit(limit)
              .for('update', { skipLocked: true })
              .execute()

            if (due.length === 0) {
              return [] as ReadonlyArray<ReturnType<typeof toEnrollmentRecord>>
            }

            const ids = due.map((row) => row.id)
            const rows = yield* trx
              .update(emailCampaignEnrollments)
              .set({ sweepLeasedUntil: leaseUntil, updatedAt: sql`now()` })
              .where(inArray(emailCampaignEnrollments.id, ids))
              .returning()
              .execute()

            return rows.map(toEnrollmentRecord)
          })
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to claim due enrollments', error))),

  /**
   * Status-guarded compare-and-set advance: only updates a still-active
   * enrollment, so a concurrent pause/cancel/unsubscribe wins (0 rows = the
   * enrollment was paused/cancelled and must not be resurrected). Always clears
   * the sweep lease.
   */
  advance: (
    id: string,
    input: {
      currentStepOrder?: number | null
      nextStepAt?: Date | null
      status?: EmailEnrollmentStatus
      completedAt?: Date | null
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()`, sweepLeasedUntil: null }
        if (input.currentStepOrder !== undefined) { patch.currentStepOrder = input.currentStepOrder }
        if (input.nextStepAt !== undefined) { patch.nextStepAt = input.nextStepAt }
        if (input.status !== undefined) { patch.status = input.status }
        if (input.completedAt !== undefined) { patch.completedAt = input.completedAt }

        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set(patch)
          .where(
            and(
              eq(emailCampaignEnrollments.id, id),
              eq(emailCampaignEnrollments.status, 'active')
            )
          )
          .returning()
          .execute()

        const row = rows[0]
        return row ? toEnrollmentRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to advance enrollment', error))),

  cancelAllForCampaign: (campaignId: string, reason: EmailCancelReason) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set({
            status: 'cancelled' as EmailEnrollmentStatus,
            cancelReason: reason,
            cancelledAt: sql`now()`,
            updatedAt: sql`now()`
          })
          .where(
            and(
              eq(emailCampaignEnrollments.campaignId, campaignId),
              eq(emailCampaignEnrollments.status, 'active')
            )
          )
          .returning({ id: emailCampaignEnrollments.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to cancel all enrollments for campaign', error))),

  // Global-unsubscribe cleanup: cancel every active enrollment for a user across
  // all campaigns. The global suppression row already stops future sends (the
  // sweep's unsubscribe guard makes the reducer stop each enrollment), so this is
  // the eager, complete version of that so no enrollment lingers 'active'.
  cancelAllForUser: (userId: string, reason: EmailCancelReason) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .update(emailCampaignEnrollments)
          .set({
            status: 'cancelled' as EmailEnrollmentStatus,
            cancelReason: reason,
            cancelledAt: sql`now()`,
            updatedAt: sql`now()`
          })
          .where(
            and(
              eq(emailCampaignEnrollments.userId, userId),
              eq(emailCampaignEnrollments.status, 'active')
            )
          )
          .returning({ id: emailCampaignEnrollments.id })
          .execute()

        return rows.length
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to cancel all enrollments for user', error)))
}
