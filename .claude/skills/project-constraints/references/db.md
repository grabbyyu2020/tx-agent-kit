---
paths:
  - "packages/infra/db/**"
---

# Database constraints (`packages/infra/db`)

| ID | Rule | Enforced by |
|---|---|---|
| DB-01 | Declare every table as `export const <name> = pgTable(` in the schema files. No `pgTable` aliases or wrapper functions. | `script:scripts/lint/invariants/utils.mjs` |
| DB-02 | Every table has `src/effect-schemas/<kebab>.ts` exporting `<Name>RowSchema` and `<Name>RowShape`, re-exported from the index. No orphan schema files. | `script:scripts/lint/invariants/db-schema-parity.mjs` |
| DB-03 | Every table has `src/factories/<kebab>.factory.ts` exporting `create<Name>Factory`, re-exported from the index. | `script:scripts/lint/invariants/db-schema-parity.mjs` |
| DB-04 | Every `json`/`jsonb` column calls `.$type<…>()` with a real type, and its RowSchema field is an explicit schema, not `Schema.Unknown` or `Schema.Json`. | `eslint:domain-structure/json-columns-require-explicit-drizzle-type`, `script:scripts/lint/invariants/db-schema-parity.mjs` |
| DB-05 | `pgEnum` values come from a tuple imported from `@tx-agent-kit/contracts` (`literals.ts`), never an inline array. | `script:scripts/lint/enforce-enum-sync.mjs`, `eslint:domain-structure/no-inline-pgenum-array` |
| DB-06 | Migrations are additive. Never edit a committed migration. Add `drizzle/migrations/NNNN_snake_case.sql` via `pnpm --filter @tx-agent-kit/db db:generate`. Numeric prefixes are unique; renumber after a merge collision. Put rollback notes in the PR. | `script:scripts/lint/invariants/temporal-contracts.mjs`, `script:packages/infra/db/src/sql-admin.ts` [prefix collisions; never-edit is review only] |
| DB-07 | Every table and column in the schema is created by some migration. | `script:scripts/lint/invariants/migration-coverage.mjs` |
| DB-08 | Every `CREATE TRIGGER` in a migration is referenced by a pgTAP suite in `pgtap/*.sql`. Run `pnpm test:db:pgtap`. | `script:scripts/lint/invariants/test-contracts.mjs` |
| DB-09 | Non-trigger `CREATE FUNCTION` SQL lives in `src/rpcs/`. | `script:scripts/lint/invariants/temporal-contracts.mjs` |
| DB-10 | Repositories in `src/repositories/` decode rows with the effect-schemas, run through `provideDB`/`withDb`, and never use `.then(`. | `script:scripts/lint/invariants/repository-contracts.mjs` |
| DB-11 | Queries on tenant-scoped tables filter on `teamId` or `organizationId` in `.where()`. | `eslint:domain-structure/enforce-tenant-scope` |
| DB-12 | `usage_records` and `credit_ledger` are financial audit trails: no `.update()` or `.delete()`, never in `retentionTableNames`, and their `organizationId` foreign keys use `onDelete: 'set null'`. Archive cold data instead of deleting it. | `eslint:domain-structure/enforce-financial-audit-immutability`, `script:scripts/lint/enforce-domain-invariants.mjs`, `script:packages/infra/db/pgtap/004_billing_immutability.pgtap.sql` [never-in-retention is review only] |
| DB-13 | A table in `retentionTableNames` (`packages/contracts/src/literals.ts`) also has an entry in the generated retention settings and a `prune*` repository method (`pruneExpired`, `pruneTerminal`, `pruneProcessed`, `prunePublished`). Set the default in `defaultRetentionSettings` (`src/system-settings-defaults.ts`) and run `pnpm db:schemas:generate` to regenerate `schemas/system-settings/reconcile_retention_settings.sql`. Only `domain_events` is pruned on a schedule today (`prunePublishedEventsWorkflow`, scheduled by `ensurePrunePublishedSchedule` in `apps/worker/src/schedules.ts`); schedule another table the same way. | `script:scripts/lint/enforce-domain-event-contracts.mjs` [partial: settings parity only] |
| DB-14 | Stripe calls that move money pass an `idempotencyKey`. Stripe is the payment rail for subscriptions, top-ups, refunds, and disputes; usage deduction is recorded in the local credit ledger, not in Stripe metered items. | `eslint:stripe-idempotency/require-idempotency-key` [partial: the ledger split is review only] |
| DB-15 | Postgres unique-violation detection (`23505`, `extractPostgresError`, `DB_UNIQUE_VIOLATION`) appears only in `src/errors.ts`. | `script:scripts/lint/enforce-source-type-safety.mjs` |
| DB-16 | Domain-event rows are inserted only through `insertDomainEventInTransaction` (see EVT-06). | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
