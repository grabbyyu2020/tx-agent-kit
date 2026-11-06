import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { type CreditEntryType } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { creditLedgerRowSchema } from '../effect-schemas/credit-ledger.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { creditLedger } from '../schema.js'

const decodeCreditLedgerRows = Schema.decodeUnknown(Schema.Array(creditLedgerRowSchema))

export const creditLedgerReadRepository = {
  listForOrganization: (input: {
    organizationId: string
    entryType?: CreditEntryType
    after?: Date
    before?: Date
    limit?: number
    cursor?: string
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const conditions = [eq(creditLedger.organizationId, input.organizationId)]

        if (input.entryType) {
          conditions.push(eq(creditLedger.entryType, input.entryType))
        }
        if (input.after) {
          conditions.push(gte(creditLedger.createdAt, input.after))
        }
        if (input.before) {
          conditions.push(lte(creditLedger.createdAt, input.before))
        }
        if (input.cursor) {
          // Compound keyset pagination. The sort is DESC createdAt,
          // DESC id, so "after the cursor" in sort order means
          // `(createdAt < cursor.createdAt) OR
          //  (createdAt = cursor.createdAt AND id < cursor.id)`.
          //
          // The caller holds only the opaque cursor id; we look up
          // its created_at under tenant scope so the filter can use
          // both columns. A plain `id < cursor` filter is wrong
          // when two rows share created_at (e.g. the release +
          // usage twins that finalizeReservation writes in one tx):
          // the next page drops whichever twin's uuid sorts above
          // the cursor, even though it's strictly "after" in DESC
          // order.
          //
          // Precision note: Drizzle decodes TIMESTAMPTZ into a JS
          // Date which is millisecond-precision, dropping the
          // Postgres microseconds. Round-tripping a Date parameter
          // back through sql`` produces a value that no longer
          // equals the row's real createdAt (`.699627` vs `.699000`)
          // and the `<` / `=` comparisons silently skip the twin.
          // Fetch created_at as TEXT via a raw cast so the full
          // resolution survives the round-trip.
          const cursorRows = yield* db.execute<{
            id: string
            created_at_text: string
          }>(sql`
            SELECT
              id::text AS id,
              created_at::text AS created_at_text
            FROM ${creditLedger}
            WHERE id = ${input.cursor}::uuid
              AND organization_id = ${input.organizationId}::uuid
            LIMIT 1
          `)

          const cursorRow = cursorRows[0]
          if (cursorRow) {
            conditions.push(sql`(
              ${creditLedger.createdAt} < ${cursorRow.created_at_text}::timestamptz
              OR (
                ${creditLedger.createdAt} = ${cursorRow.created_at_text}::timestamptz
                AND ${creditLedger.id} < ${cursorRow.id}::uuid
              )
            )`)
          } else {
            // Cursor points at a row that no longer belongs to this
            // org (e.g. cross-tenant leak attempt). Return nothing.
            return []
          }
        }

        // tenant-scope: service-validated (conditions array includes organizationId)
        const rows = yield* db
          .select()
          .from(creditLedger)
          .where(and(...conditions))
          .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
          .limit(input.limit ?? 50)
          .execute()

        return yield* decodeCreditLedgerRows(rows).pipe(
          Effect.mapError((error) => dbDecodeFailed('credit ledger list decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list credit ledger entries', error))),

  existsByStripeEventId: (stripeEventId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        // tenant-scope: service-validated (stripe_event_id is globally unique for idempotency — INV-BILLING-005)
        const rows = yield* db
          .select({ id: creditLedger.id })
          .from(creditLedger)
          .where(eq(creditLedger.stripeEventId, stripeEventId))
          .limit(1)
          .execute()

        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to check credit ledger by stripe event id', error))),

  /**
   * Scan for stale reservations: rows with `entry_type = 'reserve'` older than
   * `olderThan` that have no matching closing ledger row. A reservation is
   * considered closed when a later row exists whose `reference_id` is one of
   * `'release:<reserve_row.id>'`, `'finalize:<reserve_row.id>'`, or
   * `'cancel:<reserve_row.id>'` — the three shapes that `credit-service.ts`
   * emits via `reserve` / `finalize` / `release`.
   *
   * @spec INV-BILLING-003 — orphaned reservations must be reclaimed so held
   * balance never drifts. Returns the caller-provided `referenceId` (can be
   * null) plus the fields needed to re-drive the release through the existing
   * `creditService.release(...)` path, keeping the ledger immutable.
   */
  findStaleReservations: (input: { olderThan: Date; limit?: number }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const limit = input.limit ?? 100

        // Explicit raw SQL: Drizzle's builder cannot express a correlated
        // NOT EXISTS that concatenates the reserve row id with prefix strings
        // to match the close-row reference_id shapes.
        //
        // tenant-scope: global scan (operational reclaim across all orgs).
        const rows = yield* db
          .select({
            id: creditLedger.id,
            organizationId: creditLedger.organizationId,
            amountDecimillicents: creditLedger.amountDecimillicents,
            referenceId: creditLedger.referenceId,
            createdAt: creditLedger.createdAt
          })
          .from(creditLedger)
          .where(
            sql`${creditLedger.entryType} = 'reserve'
              AND ${creditLedger.organizationId} IS NOT NULL
              AND ${creditLedger.createdAt} < ${input.olderThan}
              AND NOT EXISTS (
                SELECT 1
                FROM ${creditLedger} AS c
                WHERE c.organization_id = ${creditLedger.organizationId}
                  AND c.reference_id IN (
                    'release:' || ${creditLedger.id}::text,
                    'finalize:' || ${creditLedger.id}::text,
                    'cancel:' || ${creditLedger.id}::text
                  )
              )`
          )
          .orderBy(creditLedger.createdAt)
          .limit(limit)
          .execute()

        // SQL guarantees `organization_id IS NOT NULL` — filter defensively
        // instead of casting so the row shape is statically non-null.
        return rows.flatMap((row) =>
          row.organizationId === null
            ? []
            : [{
                id: row.id,
                organizationId: row.organizationId,
                amountDecimillicents: row.amountDecimillicents,
                referenceId: row.referenceId,
                createdAt: row.createdAt
              }]
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find stale reservations', error)))
}
