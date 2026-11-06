---
name: project-constraints
description: Every coding constraint in tx-agent-kit, each paired with what enforces it. Load before writing or changing any code, config, migration, or test in this repository, and name the rule IDs you apply in your todo list and in every delegate brief.
---

# Project constraints

This skill is the single source of truth for how code in this repository must be shaped. `AGENTS.md` and `docs/QUALITY.md` point here. When a rule changes, change it here.

## How to use it

1. List the paths you expect to touch.
2. Find each path's area in the table below and read that reference in full. Always read `global.md` and `process.md`.
3. Write `Constraints: <IDs>` into your todo list, naming every rule that applies to the change.
4. When you delegate, put the same `Constraints:` line and the absolute paths of the reference files into the brief, and tell the delegate to read them before its first edit.
5. Before you report done, run the quality gates in `AGENTS.md` and check the diff against each listed rule. A rule whose `Enforced by` cell says `none` is checked only by you and by review, so check those by hand.

If a rule blocks a sensible change, stop and ask the user. Do not work around a rule, weaken a lint, or add a suppression.

## Areas

| Paths | Reference | Main enforcement |
|---|---|---|
| everything | [references/global.md](references/global.md) | ESLint, `scripts/lint/enforce-source-type-safety.mjs`, `scripts/lint/invariants/source-hygiene.mjs` |
| every task (instruction files, dev servers, worktrees, gates, CI) | [references/process.md](references/process.md) | `scripts/lint/enforce-agent-workflow.mjs`, `scripts/worktree/create.sh` |
| `apps/web/**` | [references/web.md](references/web.md) | `scripts/lint/enforce-web-client-contracts.mjs`, ESLint |
| `apps/api/**` | [references/api.md](references/api.md) | ESLint `domain-structure/*`, `scripts/lint/enforce-route-kind-contracts.mjs` |
| `packages/core/**`, `packages/contracts/**` | [references/core-ddd.md](references/core-ddd.md) | ESLint `domain-structure/*`, `scripts/lint/invariants/domain-structure.mjs` |
| `packages/infra/db/**` | [references/db.md](references/db.md) | `scripts/lint/invariants/db-schema-parity.mjs`, migration checks, pgTAP |
| `apps/worker/**`, `packages/temporal-client/**` | [references/worker-temporal.md](references/worker-temporal.md) | review only |
| domain events anywhere (`*-events.ts`, `events.ts`, `literals.ts`, outbox, dispatcher) | [references/domain-events.md](references/domain-events.md) | `scripts/lint/enforce-domain-event-contracts.mjs` |
| `**/*.test.ts(x)`, `packages/testkit/**`, `scripts/test/**`, `apps/web/e2e/**` | [references/testing.md](references/testing.md) | `scripts/lint/invariants/test-contracts.mjs` |

A change usually spans several areas. A new CRUD entity, for example, touches core-ddd, db, api, web, and testing.

## Hard rules that apply everywhere

These are the rules agents break most often. The full list is in the references.

- `as any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`, and `eslint-disable` are forbidden in source (GLB-02, GLB-04).
- No `console.*`. Log through `@tx-agent-kit/logging` (GLB-01).
- No TODO, FIXME, or HACK comments. Fix it now or ask (GLB-05).
- Read `process.env` only through the dedicated env modules (GLB-06).
- Validate with `effect/Schema`. zod and similar libraries are banned (GLB-08).
- `drizzle-orm` is imported only in `packages/infra/db` (GLB-09).
- Source files stay under 500 lines. Split by responsibility; never raise the limit (GLB-11).
- `apps/web` is a client-only SPA. No `effect`, no `drizzle-orm`, no `next/server`, no `app/api` (WEB-01 to WEB-03).
- `apps/web` reaches the API through the generated Orval hooks (WEB-05).
- DDD layers depend inward only. Sibling domains share only `events.ts` (CORE-02, CORE-04).
- Domain events go through the transactional outbox. `apps/api` never talks to Temporal (EVT-01, API-01).
- Temporal workflows are deterministic (WRK-01).
- `usage_records` and `credit_ledger` are financial audit trails. Never update, delete, or prune them (DB-12).
- Never bypass the gates: no `--no-verify`, no raised `INTEGRATION_TIMEOUT_SECONDS` (GLB-25, TEST-11).
- Create worktrees only with `scripts/worktree/create.sh`, and never start services with inline env vars (OPS-05, OPS-03).

## Reading the tables

Each reference has a `paths:` frontmatter list and one table with the columns `ID`, `Rule`, and `Enforced by`. Rule IDs are stable. Cite them in todos, briefs, commits, and reviews.

`Enforced by` names what fails when the rule is broken:

- `eslint:<rule-id>` is an ESLint rule configured in `packages/tooling/eslint-config/`.
- `script:<path>` is a structural check or runtime guard at that path.
- `none` means nothing mechanical catches it. A note in brackets marks partial enforcement.

`pnpm lint` checks that every `eslint:` and `script:` reference still exists. When you add a lint for a `none` rule, update its row.

ESLint flat config replaces, rather than merges, the options of a rule that two config blocks both set. Several `no-restricted-syntax` and `no-restricted-imports` selectors in `domain-invariants.js` are therefore shadowed for most files and do not fire. Rows only cite the selectors that are in effect, so a rule the config appears to cover can still say `none`.
