import { and, eq, sql } from 'drizzle-orm'
import { type CreditEntryType } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { creditLedgerRowSchema } from '../effect-schemas/credit-ledger.js'
import { dbDecodeFailed, toDbError } from '../errors.js'
import { creditLedger, organizations, type JsonObject } from '../schema.js'
import { insertDomainEventInTransaction, type InsertDomainEventInput } from './domain-events.js'
import { creditLedgerReadRepository } from './credit-ledger-reads.js'

const decodeCreditLedgerRow = Schema.decodeUnknown(creditLedgerRowSchema)

/** Entry types that mutate reservedCredits instead of creditsBalance. */
const RESERVATION_ENTRY_TYPES = new Set<CreditEntryType>(['reserve', 'release'])

export const creditLedgerRepository = {
  /**
   * Append an immutable ledger entry with the correct balance mutation.
   *
   * - `reserve`: increases reservedCredits (holds funds), guards against
   *   available balance (creditsBalance - reservedCredits) going negative.
   * - `release`: decreases reservedCredits (frees hold).
   * - All others (`purchase`, `usage`, `adjustment`, `refund`, `auto_recharge`):
   *   mutate creditsBalance directly.
   */
  append: (input: {
    organizationId: string
    entryType: CreditEntryType
    amountDecimillicents: number
    reason: string
    referenceId?: string | null
    stripeEventId?: string | null
    assetId?: string | null
    phase?: string | null
    metadata?: JsonObject
    /**
     * When true, the transaction re-reads `organizations.suspended_at`
     * under the FOR UPDATE lock and fails with a
     * "Organization is suspended" sentinel error if it is not null.
     * Callers (e.g. `creditService.reserve`) used to check suspension
     * via a separate unscoped SELECT before the append transaction,
     * which opened a small race window: a suspension that fired
     * between the check and the lock would still let the reserve
     * commit. Moving the check inside the lock closes that window.
     *
     * @spec INV-BILLING-003, billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
     */
    failIfSuspended?: boolean
    /**
     * Optional domain event to insert into `domain_events` within the same
     * transaction as the ledger append.
     *
     * @spec INV-BILLING-009 — threshold-crossing and state-change events must
     * commit atomically with the credit mutation that triggers them.
     */
    outboxEvent?: InsertDomainEventInput
    /**
     * Optional `organizations.welcome_credit_granted_at` stamp. When set,
     * the same transaction issues an atomic UPDATE of the column so the
     * welcome credit grant + audit column commit together. Without this,
     * a crash between the ledger commit and a separate column write
     * leaves the column NULL forever and every subsequent invoice
     * re-enters the grant branch (rescued only by the referenceId
     * idempotency guard above).
     *
     * @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
     */
    stampWelcomeCreditAt?: Date
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const isReservation = RESERVATION_ENTRY_TYPES.has(input.entryType)

        const result = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            // Lock the org row for atomic read-modify-write. We MUST take
            // the lock before the idempotency check — under READ COMMITTED
            // isolation, two parallel appenders with the same referenceId
            // could both read "no existing row", then contend for the
            // lock. Without the pre-lock ordering, the loser would hit
            // the over-release / over-debit guard instead of the idempotent
            // early-return path.
            //
            // @spec INV-BILLING-003 — concurrent reclaim against the same
            // orphaned reservation must collapse to exactly one release.
            const lockRows = yield* trx
              .select({
                creditsBalance: organizations.creditsBalance,
                reservedCredits: organizations.reservedCredits,
                suspendedAt: organizations.suspendedAt,
                paymentGracePeriodEndsAt: organizations.paymentGracePeriodEndsAt
              })
              .from(organizations)
              .where(eq(organizations.id, input.organizationId))
              .for('update')
              .execute()

            const org = lockRows[0]
            if (!org) {
              return yield* Effect.fail(new Error('Organization not found'))
            }

            // @spec INV-BILLING-003 — suspension + grace period guard inside
            // the lock. Callers that pass `failIfSuspended` (e.g. credit-
            // service reserve) need the check to happen AFTER the FOR
            // UPDATE lock is acquired so a concurrent setSuspended /
            // setPaymentGracePeriod that fires between the caller's
            // separate check and this transaction cannot slip through.
            //
            // Spec (billing-and-pricing-design §"Failed Payment Lifecycle"):
            //   invoice.payment_failed → operations suspended (reads allowed,
            //   no new AI/uploads) until the payment is resolved.
            //
            // The grace period field is cleared ONLY by invoice.payment_succeeded,
            // so any non-null value means "there is an unresolved failed
            // payment in effect" — whether the clock has passed the end
            // timestamp or not. Wall-clock expiry does not re-enable the
            // org.
            if (input.failIfSuspended === true) {
              if (org.suspendedAt !== null) {
                return yield* Effect.fail(new Error('Organization is suspended'))
              }
              if (org.paymentGracePeriodEndsAt !== null) {
                return yield* Effect.fail(
                  new Error('Organization is suspended: unresolved failed payment (grace period active)')
                )
              }
            }

            // Idempotency guard: if referenceId already exists, return
            // existing entry. Run this UNDER the FOR UPDATE lock so a
            // concurrent writer that committed the same referenceId
            // cannot sneak past this check.
            if (input.referenceId) {
              // tenant-scope: service-validated (referenceId is globally unique within org context)
              const existing = yield* trx
                .select()
                .from(creditLedger)
                .where(and(
                  eq(creditLedger.organizationId, input.organizationId),
                  eq(creditLedger.referenceId, input.referenceId)
                ))
                .limit(1)
                .execute()

              if (existing[0]) {
                return existing[0]
              }
            }

            if (isReservation) {
              // Reserve: increase reservedCredits. Guard: available >= amount to reserve.
              if (input.entryType === 'reserve') {
                if (input.amountDecimillicents < 0) {
                  return yield* Effect.fail(new Error('Reserve amount must be non-negative'))
                }
                const reserveAmount = input.amountDecimillicents
                const available = org.creditsBalance - org.reservedCredits
                if (available < reserveAmount) {
                  return yield* Effect.fail(new Error(
                    `Insufficient available balance: available=${available}, requested=${reserveAmount}`
                  ))
                }

                yield* trx
                  .update(organizations)
                  .set({
                    reservedCredits: sql`${organizations.reservedCredits} + ${reserveAmount}`,
                    updatedAt: sql`now()`
                  })
                  .where(eq(organizations.id, input.organizationId))
                  .execute()
              } else {
                // Release: decrease reservedCredits
                if (input.amountDecimillicents < 0) {
                  return yield* Effect.fail(new Error('Release amount must be non-negative'))
                }
                const releaseAmount = input.amountDecimillicents
                if (releaseAmount > org.reservedCredits) {
                  return yield* Effect.fail(new Error(
                    `Over-release: attempting to release ${releaseAmount} but only ${org.reservedCredits} reserved`
                  ))
                }

                yield* trx
                  .update(organizations)
                  .set({
                    reservedCredits: sql`${organizations.reservedCredits} - ${releaseAmount}`,
                    updatedAt: sql`now()`
                  })
                  .where(eq(organizations.id, input.organizationId))
                  .execute()
              }
            } else {
              // Settlement entries: mutate creditsBalance directly
              if (input.amountDecimillicents < 0) {
                // Debit: guard against consuming already-reserved funds
                const newBalance = org.creditsBalance + input.amountDecimillicents
                if (newBalance < org.reservedCredits) {
                  return yield* Effect.fail(new Error(
                    `Insufficient available credits: balance=${org.creditsBalance}, reserved=${org.reservedCredits}, debit=${input.amountDecimillicents}`
                  ))
                }
              }

              yield* trx
                .update(organizations)
                .set({
                  creditsBalance: sql`${organizations.creditsBalance} + ${input.amountDecimillicents}`,
                  updatedAt: sql`now()`
                })
                .where(eq(organizations.id, input.organizationId))
                .execute()
            }

            // Re-read both balances after mutation for ledger snapshot
            const afterRows = yield* trx
              .select({
                creditsBalance: organizations.creditsBalance,
                reservedCredits: organizations.reservedCredits
              })
              .from(organizations)
              .where(eq(organizations.id, input.organizationId))
              .execute()

            const balanceAfter = afterRows[0]?.creditsBalance ?? 0

            const ledgerRows = yield* trx
              .insert(creditLedger)
              .values({
                organizationId: input.organizationId,
                amountDecimillicents: input.amountDecimillicents,
                entryType: input.entryType,
                reason: input.reason,
                referenceId: input.referenceId ?? null,
                stripeEventId: input.stripeEventId ?? null,
                assetId: input.assetId ?? null,
                phase: input.phase ?? null,
                balanceAfter,
                metadata: input.metadata ?? {}
              })
              .returning()
              .execute()

            const row = ledgerRows[0]
            if (!row) {
              return yield* Effect.fail(new Error('Failed to insert credit ledger entry'))
            }

            // @spec INV-BILLING-009 — emit outbox event in the same tx
            if (input.outboxEvent) {
              yield* insertDomainEventInTransaction(trx, input.outboxEvent)
            }

            // @spec INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG — atomic
            // welcome-credit audit column stamp. The webhook handler
            // sets this on the FIRST successful invoice charge so the
            // ledger row + column write commit together; subsequent
            // renewals find the column non-null and skip the grant
            // branch entirely (the referenceId guard above is the
            // belt to this suspenders).
            if (input.stampWelcomeCreditAt) {
              yield* trx
                .update(organizations)
                .set({
                  welcomeCreditGrantedAt: input.stampWelcomeCreditAt,
                  updatedAt: sql`now()`
                })
                .where(eq(organizations.id, input.organizationId))
                .execute()
            }

            return row
          })
        )

        return yield* decodeCreditLedgerRow(result).pipe(
          Effect.mapError((error) => dbDecodeFailed('credit ledger row decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to append credit ledger entry', error))),

  /**
   * Atomic finalize: release hold + debit actual cost in a single transaction.
   * Prevents the half-applied state where release commits but debit fails.
   */
  finalizeReservation: (input: {
    organizationId: string
    releaseAmount: number
    debitAmount: number
    releaseReferenceId: string
    debitReferenceId: string
    releaseReason: string
    debitReason: string
    assetId?: string | null
    phase?: string | null
    metadata?: JsonObject
    /**
     * Optional threshold to emit `billing.credits_low_balance` when the new
     * available balance drops below `lowBalanceThreshold` (typically the org's
     * `auto_recharge_threshold`). Emission happens ATOMICALLY with the debit.
     *
     * @spec INV-BILLING-009
     */
    lowBalanceThreshold?: number | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const result = yield* db.transaction((trx) =>
          Effect.gen(function* () {
            // Lock the org row BEFORE the idempotency check. Under
            // READ COMMITTED isolation, a pre-lock existence check
            // would let two concurrent finalizes both pass through
            // and race on the release+debit decrement. Taking the
            // FOR UPDATE lock first means the second caller blocks
            // until the first commits, then sees the existing release
            // row and returns via the idempotent early-return.
            //
            // @spec INV-BILLING-003 — concurrent finalize for the same
            // reservationId must collapse to exactly one release+debit.
            const lockRows = yield* trx
              .select({
                creditsBalance: organizations.creditsBalance,
                reservedCredits: organizations.reservedCredits
              })
              .from(organizations)
              .where(eq(organizations.id, input.organizationId))
              .for('update')
              .execute()

            const org = lockRows[0]
            if (!org) {
              return yield* Effect.fail(new Error('Organization not found'))
            }

            // Idempotency guard: check if either the release or debit row already exists.
            // The release row is inserted first, so if it exists the org UPDATE already committed.
            // tenant-scope: service-validated (referenceId scoped to org context)
            const existingRelease = yield* trx
              .select()
              .from(creditLedger)
              .where(and(
                eq(creditLedger.organizationId, input.organizationId),
                eq(creditLedger.referenceId, input.releaseReferenceId)
              ))
              .limit(1)
              .execute()

            if (existingRelease[0]) {
              // Release already committed — find and return the debit row (or the release if debit failed)
              const existingDebit = yield* trx
                .select()
                .from(creditLedger)
                .where(and(
                  eq(creditLedger.organizationId, input.organizationId),
                  eq(creditLedger.referenceId, input.debitReferenceId)
                ))
                .limit(1)
                .execute()
              return existingDebit[0] ?? existingRelease[0]
            }

            // Validate inputs
            if (input.releaseAmount < 0) {
              return yield* Effect.fail(new Error('Release amount must be non-negative'))
            }
            if (input.debitAmount < 0) {
              return yield* Effect.fail(new Error('Debit amount must be non-negative'))
            }

            // Step 1: Release the hold
            if (input.releaseAmount > org.reservedCredits) {
              return yield* Effect.fail(new Error(
                `Over-release: attempting to release ${input.releaseAmount} but only ${org.reservedCredits} reserved`
              ))
            }

            // Step 2: Check debit won't consume reserved funds
            const newBalance = org.creditsBalance - input.debitAmount
            if (newBalance < (org.reservedCredits - input.releaseAmount)) {
              return yield* Effect.fail(new Error(
                `Insufficient available credits: balance=${org.creditsBalance}, reserved=${org.reservedCredits}, releaseAmount=${input.releaseAmount}, debit=${input.debitAmount}`
              ))
            }

            // Apply both mutations atomically
            yield* trx
              .update(organizations)
              .set({
                reservedCredits: sql`${organizations.reservedCredits} - ${input.releaseAmount}`,
                creditsBalance: sql`${organizations.creditsBalance} - ${input.debitAmount}`,
                updatedAt: sql`now()`
              })
              .where(eq(organizations.id, input.organizationId))
              .execute()

            // Re-read balances
            const afterRows = yield* trx
              .select({
                creditsBalance: organizations.creditsBalance,
                reservedCredits: organizations.reservedCredits
              })
              .from(organizations)
              .where(eq(organizations.id, input.organizationId))
              .execute()

            const balanceAfter = afterRows[0]?.creditsBalance ?? 0

            // Insert release ledger entry
            yield* trx
              .insert(creditLedger)
              .values({
                organizationId: input.organizationId,
                amountDecimillicents: input.releaseAmount,
                entryType: 'release',
                reason: input.releaseReason,
                referenceId: input.releaseReferenceId,
                balanceAfter: org.creditsBalance, // balance before debit
                metadata: {}
              })
              .execute()

            // Insert debit ledger entry
            const debitRows = yield* trx
              .insert(creditLedger)
              .values({
                organizationId: input.organizationId,
                amountDecimillicents: -input.debitAmount,
                entryType: 'usage',
                reason: input.debitReason,
                referenceId: input.debitReferenceId,
                assetId: input.assetId ?? null,
                phase: input.phase ?? null,
                balanceAfter,
                metadata: input.metadata ?? {}
              })
              .returning()
              .execute()

            const row = debitRows[0]
            if (!row) {
              return yield* Effect.fail(new Error('Failed to insert finalize ledger entry'))
            }

            // @spec INV-BILLING-009 — emit low-balance outbox event atomically.
            // Emit when the new available balance crosses the threshold from
            // above to below (exclusive strict crossing avoids re-emit noise).
            if (
              input.lowBalanceThreshold !== undefined &&
              input.lowBalanceThreshold !== null &&
              input.lowBalanceThreshold > 0
            ) {
              const availableBefore = org.creditsBalance - org.reservedCredits
              const availableAfter =
                (afterRows[0]?.creditsBalance ?? 0) -
                (afterRows[0]?.reservedCredits ?? 0)

              if (
                availableBefore >= input.lowBalanceThreshold &&
                availableAfter < input.lowBalanceThreshold
              ) {
                yield* insertDomainEventInTransaction(trx, {
                  eventType: 'billing.credits_low_balance',
                  aggregateType: 'billing',
                  aggregateId: input.organizationId,
                  payload: {
                    organizationId: input.organizationId,
                    currentBalanceDecimillicents: availableAfter,
                    thresholdDecimillicents: input.lowBalanceThreshold
                  },
                  correlationId: row.id
                })
              }
            }

            return row
          })
        )

        return yield* decodeCreditLedgerRow(result).pipe(
          Effect.mapError((error) => dbDecodeFailed('finalize ledger row decode failed', error))
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to finalize reservation', error))),

  ...creditLedgerReadRepository,

  /**
   * Atomically release a stale reservation. Takes an `organizations FOR
   * UPDATE` lock, then re-checks under the lock that NO close-row
   * (cancel/release/finalize) already exists for this reserve id. Only
   * then decrements `reserved_credits` and inserts the `cancel:<id>`
   * close row.
   *
   * This is the idempotency guard for the reclaim race: a concurrent
   * `finalize` call might write `release:<id>` + `finalize:<id>` between
   * the reclaim scan and this append. Without the under-lock re-check,
   * the reclaim would hit the generic `append`'s over-release guard and
   * surface a spurious "Over-release" error. Here we detect that the
   * reserve has already been closed (by any of the three paths) and
   * return `{ released: false }` — a clean no-op.
   *
   * Returns:
   *   - `{ released: true, row }` when this call was the race winner
   *     and the decrement + close-row insert succeeded.
   *   - `{ released: false }` when a concurrent finalize / release /
   *     prior reclaim beat us to it.
   *
   * @spec INV-BILLING-003 — concurrent reclaim + finalize on the same
   * reservation must collapse to exactly one close-row.
   */
  tryReleaseStaleReservation: (input: {
    organizationId: string
    reserveId: string
    amountDecimillicents: number
    reason: string
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        return yield* db.transaction((trx) =>
          Effect.gen(function* () {
            // Lock the org row first so concurrent writers queue here.
            const lockRows = yield* trx
              .select({
                creditsBalance: organizations.creditsBalance,
                reservedCredits: organizations.reservedCredits
              })
              .from(organizations)
              .where(eq(organizations.id, input.organizationId))
              .for('update')
              .execute()

            const org = lockRows[0]
            if (!org) {
              return yield* Effect.fail(new Error('Organization not found'))
            }

            // Re-check the close-row triad under the lock. If ANY of
            // cancel:<id> / release:<id> / finalize:<id> already exists,
            // the reserve has been closed by another path — skip.
            const closeRows = yield* trx
              .select({ id: creditLedger.id })
              .from(creditLedger)
              .where(and(
                eq(creditLedger.organizationId, input.organizationId),
                sql`${creditLedger.referenceId} IN (
                  ${'cancel:' + input.reserveId},
                  ${'release:' + input.reserveId},
                  ${'finalize:' + input.reserveId}
                )`
              ))
              .limit(1)
              .execute()

            if (closeRows.length > 0) {
              return { released: false as const }
            }

            // Defence in depth: if reserved_credits < amount, another
            // writer must have already released this reserve via an
            // unexpected path. Treat as no-op rather than over-releasing.
            if (input.amountDecimillicents > org.reservedCredits) {
              return { released: false as const }
            }

            // Decrement reserved_credits and insert the cancel:<id> row.
            yield* trx
              .update(organizations)
              .set({
                reservedCredits: sql`${organizations.reservedCredits} - ${input.amountDecimillicents}`,
                updatedAt: sql`now()`
              })
              .where(eq(organizations.id, input.organizationId))
              .execute()

            const afterRows = yield* trx
              .select({ creditsBalance: organizations.creditsBalance })
              .from(organizations)
              .where(eq(organizations.id, input.organizationId))
              .execute()
            const balanceAfter = afterRows[0]?.creditsBalance ?? 0

            const inserted = yield* trx
              .insert(creditLedger)
              .values({
                organizationId: input.organizationId,
                amountDecimillicents: input.amountDecimillicents,
                entryType: 'release',
                reason: input.reason,
                referenceId: `cancel:${input.reserveId}`,
                balanceAfter,
                metadata: {}
              })
              .returning()
              .execute()

            const row = inserted[0]
            if (!row) {
              return yield* Effect.fail(new Error('Failed to insert stale-reclaim ledger entry'))
            }

            return { released: true as const, row }
          })
        )
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to release stale reservation', error)))
}
