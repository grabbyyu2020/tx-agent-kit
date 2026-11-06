import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { EmailSourceSystem, EmailSuppressionReason } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { DB, provideDB } from '../client.js'
import { emailUnsubscribeRowSchema } from '../effect-schemas/email-unsubscribes.js'
import { toDbError } from '../errors.js'
import { emailSuppressionList, emailUnsubscribes } from '../schema.js'
import { createNullableDecoder } from './sql-helpers.js'

// Send guards: per-user unsubscribes (email_unsubscribes) and the per-address
// suppression list (email_suppression_list). Both are checked before enrolling
// and before each drip send.

// ---------------------------------------------------------------------------
// Effect schema decoders — validate DB rows at runtime boundaries
// ---------------------------------------------------------------------------

const decodeNullableUnsubscribe = createNullableDecoder(emailUnsubscribeRowSchema, 'email unsubscribe row')

export { decodeNullableUnsubscribe }

// ---------------------------------------------------------------------------
// Row-to-domain mapping helpers
// ---------------------------------------------------------------------------

type UnsubscribeRow = typeof emailUnsubscribes.$inferSelect

const toUnsubscribeRecord = (row: UnsubscribeRow) => ({
  id: row.id,
  userId: row.userId,
  campaignId: row.campaignId,
  unsubscribedAt: row.unsubscribedAt,
  createdAt: row.createdAt
})

// ---------------------------------------------------------------------------
// unsubscribeRepository
// ---------------------------------------------------------------------------

export const unsubscribeRepository = {
  isUnsubscribed: (userId: string, campaignId: string | null) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const whereClause = campaignId
          ? and(
              eq(emailUnsubscribes.userId, userId),
              eq(emailUnsubscribes.campaignId, campaignId)
            )
          : and(
              eq(emailUnsubscribes.userId, userId),
              isNull(emailUnsubscribes.campaignId)
            )

        const rows = yield* db
          .select({ id: emailUnsubscribes.id })
          .from(emailUnsubscribes)
          .where(whereClause)
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check unsubscribe status', error))),

  /**
   * One-query check: is the user unsubscribed from this campaign specifically OR
   * globally (campaignId null)? Collapses the two `isUnsubscribed` round-trips the
   * enroll/send seams previously made into a single query.
   */
  isUnsubscribedFromAny: (userId: string, campaignId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({ id: emailUnsubscribes.id })
          .from(emailUnsubscribes)
          .where(
            and(
              eq(emailUnsubscribes.userId, userId),
              or(eq(emailUnsubscribes.campaignId, campaignId), isNull(emailUnsubscribes.campaignId))
            )
          )
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check unsubscribe status', error))),

  /**
   * Batch unsubscribe lookup for several users in one query. Returns every
   * (userId, campaignId) unsubscribe row (campaignId null = global). The caller
   * groups by userId. Used by the drip sweep.
   */
  findForUsers: (userIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (userIds.length === 0) {
          return []
        }
        const rows = yield* db
          .select({ userId: emailUnsubscribes.userId, campaignId: emailUnsubscribes.campaignId })
          .from(emailUnsubscribes)
          .where(inArray(emailUnsubscribes.userId, [...userIds]))
          .execute()

        return rows
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch unsubscribes for users', error))),

  unsubscribe: (input: { userId: string; campaignId: string | null }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailUnsubscribes)
          .values({
            userId: input.userId,
            campaignId: input.campaignId
          })
          .onConflictDoNothing()
          .returning()
          .execute()

        const row = rows[0]

        if (!row) {
          // Already unsubscribed — fetch existing record
          const whereClause = input.campaignId
            ? and(
                eq(emailUnsubscribes.userId, input.userId),
                eq(emailUnsubscribes.campaignId, input.campaignId)
              )
            : and(
                eq(emailUnsubscribes.userId, input.userId),
                isNull(emailUnsubscribes.campaignId)
              )

          const existing = yield* db
            .select()
            .from(emailUnsubscribes)
            .where(whereClause)
            .limit(1)
            .execute()

          const existingRow = existing[0]
          if (!existingRow) {
            return yield* Effect.fail(new Error('Unsubscribe record not found after conflict'))
          }

          return toUnsubscribeRecord(existingRow)
        }

        return toUnsubscribeRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to unsubscribe', error)))
}

// ---------------------------------------------------------------------------
// suppressionRepository
// ---------------------------------------------------------------------------

export const suppressionRepository = {
  isSuppressed: (email: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({ id: emailSuppressionList.id })
          .from(emailSuppressionList)
          .where(
            and(
              eq(sql`lower(${emailSuppressionList.email})`, sql`lower(${email})`),
              isNull(emailSuppressionList.liftedAt)
            )
          )
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check email suppression', error))),

  /**
   * Add an address to the suppression list (e.g. after a hard bounce or spam
   * complaint webhook), so the drip sweep + enroll stop emailing it. Idempotent:
   * a second suppression for an already-active address is a no-op via the partial
   * unique index on lower(email) WHERE lifted_at IS NULL.
   */
  suppress: (input: {
    email: string
    reason: EmailSuppressionReason
    sourceSystem: EmailSourceSystem
    sourceId: string | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        yield* db
          .insert(emailSuppressionList)
          .values({
            email: input.email,
            reason: input.reason,
            sourceSystem: input.sourceSystem,
            sourceId: input.sourceId
          })
          .onConflictDoNothing()
          .execute()
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to add email to suppression list', error))),

  /**
   * Batch suppression check: returns the lowercased subset of `emails` that are
   * actively suppressed (one query). Used by the drip sweep.
   */
  findSuppressed: (emails: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (emails.length === 0) {
          return []
        }
        const lowered = emails.map((email) => email.toLowerCase())
        const rows = yield* db
          .select({ email: emailSuppressionList.email })
          .from(emailSuppressionList)
          .where(
            and(
              inArray(sql`lower(${emailSuppressionList.email})`, lowered),
              isNull(emailSuppressionList.liftedAt)
            )
          )
          .execute()

        return rows.map((row) => row.email.toLowerCase())
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch email suppression list', error)))
}
