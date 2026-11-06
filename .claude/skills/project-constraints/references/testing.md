---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "packages/testkit/**"
  - "scripts/test/**"
  - "apps/web/e2e/**"
  - "vitest*.ts"
---

# Testing constraints

| ID | Rule | Enforced by |
|---|---|---|
| TEST-01 | TDD: write the failing test first, then the code. For React pages and components, write the `*.integration.test.tsx` before the component exists. | none |
| TEST-02 | Prefer, in order: integration tests (real API + DB + components), property-based tests for rule-heavy domain logic, unit tests only where integration is impractical, and Playwright E2E only for critical multi-page journeys. | none |
| TEST-03 | Tests are colocated as `<file>.test.ts(x)` or `<file>.integration.test.ts(x)` next to a source file. No `__tests__/` folders, `.spec.*`, or `.integration.ts(x)` names. | `script:scripts/lint/invariants/test-contracts.mjs` |
| TEST-04 | Every test file imports from `vitest`. | `script:scripts/lint/invariants/test-contracts.mjs` |
| TEST-05 | Never commit `.only()`. | `eslint:no-only-tests/no-only-tests` |
| TEST-06 | Tests are idempotent, deterministic, and rerunnable. Seed through the testkit factories or API fixtures rather than raw DB writes, and clean up what you create. Never hard-code emails (opt out with an `ALLOW_HARDCODED_TEST_EMAIL` comment) or ports. | `script:scripts/lint/enforce-no-hardcoded-test-emails.mjs`, `eslint:domain-structure/no-hardcoded-test-ports` [partial: API integration tests only] |
| TEST-07 | API integration tests use `createDbAuthContext(...)` or `createTestFixture` from `@tx-agent-kit/testkit` (`setup` in `beforeAll`, `reset` in `beforeEach`, `teardown` in `afterAll`). Resolve `apiCwd` with `fileURLToPath(import.meta.url)`, never `process.cwd()`. Never spawn processes or use `createSqlTestContext` directly. | `script:scripts/lint/invariants/test-contracts.mjs`, `eslint:no-restricted-syntax` [`spawn` selector], `eslint:domain-structure/extract-test-fixture-setup` |
| TEST-08 | Web integration tests use `renderWithProviders` against the real API, inject auth with `writeAuthToken(token)`, seed with `createWebFactoryContext()` plus `createUser`/`createOrganization`, and query with `getByRole`/`findBy*`/`waitFor`, not CSS selectors or fixed sleeps. Suite lifecycle lives only in `apps/web/vitest.integration.setup.ts`. | `eslint:testing-library/prefer-find-by`, `eslint:testing-library/await-async-queries`, `eslint:testing-library/await-async-utils`, `eslint:testing-library/no-await-sync-queries`, `eslint:no-restricted-syntax` [fixed-sleep selector, `.test.tsx` only], `script:scripts/lint/invariants/test-contracts.mjs` |
| TEST-09 | Integration suites run from the root `vitest.integration.workspace.ts` with the shared `scripts/test/vitest-global-setup.ts`. Package configs define no `globalSetup`, `groupOrder`, `maxWorkers: 1`, or `fileParallelism: false`. Parallelism is tuned only through `INTEGRATION_MAX_WORKERS`, `WEB_INTEGRATION_MAX_WORKERS`, and `TEST_MAX_WORKERS`. | `script:scripts/lint/invariants/test-contracts.mjs` |
| TEST-10 | Never skip tests and never skip infrastructure. Run `pnpm infra:ensure` first; it is shared across worktrees, so never tear it down. Kill stale servers with `lsof -ti :<port> \| xargs kill -9` on a port conflict. | none |
| TEST-11 | Integration budget: 120 s wall clock locally (CI has no wall-clock cap but still reports tests over 10 s); 30 s per test and hook locally and 60 s in CI. Never raise `INTEGRATION_TIMEOUT_SECONDS`, `INTEGRATION_TEST_TIMEOUT_MS`, or `INTEGRATION_HOOK_TIMEOUT_MS` to pass; profile and split the slow test. To debug a hang, run the single file directly. | `script:scripts/test-integration-quiet.sh` [partial: enforces the local wall clock; raising the env vars is review only], `script:packages/tooling/vitest-config/integration.ts` [partial: sets the per-test defaults] |
| TEST-12 | The browser E2E run is capped at 120 s. Never widen it. | `script:scripts/lint/enforce-e2e-budget.mjs` |
| TEST-13 | Keep the critical baseline suites: API health/auth/organization/invitation coverage with invitation idempotency and a health latency assertion; web suites for `DashboardPage`, `OrganizationsPage`, `InvitationsPage`, `AuthForm`, `CreateOrganizationForm`, `CreateInvitationForm`, `AcceptInvitationForm`, `SignOutButton`, `ForgotPasswordForm`, `ResetPasswordForm`, and `client-auth` guards, including unauthenticated redirects (`/sign-in?next=…`), 401 handling, and authenticated data loading; worker activity idempotency. | `script:scripts/lint/invariants/test-contracts.mjs` [partial: redirect, 401, and `processOperation` assertions are review only] |
| TEST-14 | Ports: API integration uses `4100 + WORKTREE_PORT_OFFSET`; web slots use 4401, 4411, 4421, 4431. A suite that needs its own API uses a unique port from an env override such as `API_INTEGRATION_TEST_PORT_TENANCY`. | none |
| TEST-15 | Tests never call paid external APIs in CI. Replay recorded HTTP with `createHttpVcrFetch` from `@tx-agent-kit/http-vcr` (record with `HTTP_VCR_RECORD=1`) or mock with MSW. | none |
| TEST-16 | Database trigger contracts are pgTAP suites in `packages/infra/db/pgtap/`, run by `pnpm test:db:pgtap`. | `script:scripts/lint/invariants/test-contracts.mjs` |

## Integration harness sketch

```typescript
const ctx = createDbAuthContext({
  apiCwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  authSecret: 'integration-auth-secret-minimum-32-chars',
  corsOrigin: 'http://localhost:3000',
  sql: { schemaPrefix: 'mytest' }
})

beforeAll(() => ctx.setup())
beforeEach(() => ctx.reset())
afterAll(() => ctx.teardown())
```

Omitting `port` points the suite at the shared integration API. Pass a port only when the suite needs its own API process (TEST-14).

Testkit factories: `createUser(ctx)`, `createUserWithOrg(ctx)`, `createInvitation(ctx, opts)`, `createOrganization(ctx, opts)`, and `asUser(ctx, session)` for an authenticated HTTP client. Each suite gets its own Postgres schema; resets truncate mutable tables and keep the seed tables (`__tx_agent_migrations`, `roles`, `permissions`, `role_permissions`, `system_settings`).
