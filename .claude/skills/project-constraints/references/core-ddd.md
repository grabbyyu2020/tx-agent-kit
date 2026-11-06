---
paths:
  - "packages/core/**"
  - "packages/contracts/**"
---

# Core DDD constraints (`packages/core`, `packages/contracts`)

## Domain layout

```txt
packages/core/src/domains/<domain>/
  events.ts       # PUBLIC cross-domain event contract (the only importable file)
  domain/         # entities, value objects, pure rules, event payloads
  ports/          # capability contracts (repository seams)
  application/    # use-case orchestration
  adapters/       # external system adapters
  runtime/        # layer wiring (optional)
```

Events are public nouns. Ports are public verbs. Errors are private semantics.

| ID | Rule | Enforced by |
|---|---|---|
| CORE-01 | Each domain has `domain/`, `ports/`, `application/`, and `adapters/`, each with at least one file, plus optional `runtime/` and `events.ts`. No `repositories/` or `services/` folders. | `script:scripts/lint/invariants/domain-structure.mjs`, `eslint:domain-structure/require-domain-structure` |
| CORE-02 | Dependencies point inward. `domain` imports only `domain`. `ports` imports `domain` and `ports`. `application` imports `domain`, `ports`, and `application`. `adapters` import `domain`, `ports`, and `adapters`. | `eslint:domain-structure/enforce-layer-boundaries`, `eslint:no-restricted-imports`, `script:scripts/lint/invariants/domain-structure.mjs` |
| CORE-03 | `runtime/` and UI layers orchestrate; they never pull persistence concerns back into inner layers. | none |
| CORE-04 | A domain imports from a sibling domain only its root `events.ts`, and only with `import type`. Never import a sibling's services, repositories, domain logic, or errors. | `eslint:domain-structure/enforce-layer-boundaries`, `script:scripts/lint/invariants/domain-structure.mjs` [partial: `import type` is review only] |
| CORE-05 | The domain layer is pure. It may use `Either`, `Option`, `pipe`, `Data`, and `Match`, but not `Effect`, `Layer`, `Context`, `Fiber`, or `Runtime`, and it never imports infra. | `eslint:domain-structure/pure-domain-no-effect-imports`, `eslint:domain-structure/pure-domain-no-infra-imports` |
| CORE-06 | No `throw` or `try` outside `adapters/` and `runtime/`. Return `Either` when an operation can fail in typed ways, `Option` when a value may be absent, a plain value when it always succeeds, and a boolean for yes/no checks. | `eslint:domain-structure/no-throw-try-outside-adapters` |
| CORE-07 | Domain code is deterministic: no `Date.now()`, `new Date()`, or `Math.random()`. Pass time and randomness in. | none [ESLint selectors are shadowed] |
| CORE-08 | Domain records extend or alias their DB row shape (`extends XRowShape`, `type X = XRowShape`, `Omit<…>` to narrow JSONB, `Pick<…>` for subsets). Standalone interfaces are banned except DTO-style names (`Aggregate`, `View`, `Dashboard`, `Command`, `Input`, `Options`, `Result`, `Payload`, and similar). | `eslint:domain-structure/enforce-domain-extends-row-shape`, `script:scripts/lint/invariants/domain-extends-parity.mjs` |
| CORE-09 | Multi-table records: (A) extend the primary row shape and add joined fields, (B) compose records in an `…Aggregate`/`…View`/`…Dashboard` type, or (C) intersect for a flat view. The repository writes the joins; the port declares the aggregate type. | none |
| CORE-10 | Ports are `Context.Tag` classes in `ports/*-ports.ts` named `…Port` with a tag string equal to the class name. Methods return `Effect.Effect<…>`, never `Promise`. Ports provide no `Layer`. Repository ports declare one `<Name>RepositoryKind` of `'crud'` or `'custom'`. | `eslint:domain-structure/enforce-service-naming`, `eslint:domain-structure/ports-no-layer-providers`, `script:scripts/lint/invariants/domain-structure.mjs`, `script:scripts/lint/enforce-route-kind-contracts.mjs` |
| CORE-11 | A port's `create` input includes every NOT NULL column without a default. | `script:scripts/lint/invariants/port-create-coverage.mjs` |
| CORE-12 | Application services live in `application/*-service.ts`, end in `Service`, use `Effect.gen`, depend only on ports (never on `@tx-agent-kit/db`, adapters, or repositories), and bridge domain `Either` to `Effect.fail`. | `eslint:domain-structure/enforce-service-naming`, `eslint:no-restricted-imports` |
| CORE-13 | Adapters import at least one port, map DB rows with the shared row mappers, and narrow JSONB on write. | `eslint:domain-structure/adapters-must-import-port`, `eslint:domain-structure/core-adapters-use-db-row-mappers` |
| CORE-14 | Errors: rich typed ADTs stay inside the domain. Ports expose seam-specific error types. The application layer remaps into `CoreError` with the factories (`badRequest`, `notFound`, `unauthorized`, `conflict`, `internalError`), never `new CoreError(`. The API maps to HTTP. Never import another domain's error types. | `eslint:domain-structure/enforce-core-error-factories` [partial: the seam rules are review only] |
| CORE-15 | Error handlers keep the original error. | `eslint:domain-structure/no-swallowed-errors` |
| CORE-16 | DDD layer files use named exports only; no `*-service.ts` outside `domains/`. | `script:scripts/lint/invariants/domain-structure.mjs` |
| CORE-17 | Concrete persistence lives only in `packages/infra/db/src/repositories/`. Core ports are abstract seams. | `script:scripts/lint/invariants/domain-structure.mjs`, `script:scripts/lint/invariants/repository-contracts.mjs` |
| CORE-18 | No `Effect.promise` or `new Promise()` in core; use `Effect.tryPromise`. | `eslint:no-restricted-syntax` [`effect-consistency.js`] |
| CORE-19 | Permissions are defined in `packages/contracts/src/permissions.ts`, with actions in `literals.ts`. After a change run `pnpm permissions:sync` to regenerate the reconcile SQL. | `script:scripts/permissions-sync.mjs` |
| CORE-20 | Contracts are `effect/Schema` definitions in `packages/contracts`; shared constants in `constants.ts`, shared literal tuples in `literals.ts`. | `eslint:no-restricted-imports` [partial: bans other validation libraries] |
| CORE-21 | Export new public services, ports, and events from `packages/core/src/index.ts`. | none |
| CORE-22 | Feature path for a new entity: `pnpm scaffold:crud --domain <d> --entity <e> --dry-run`, then contracts (`effect/Schema`), core domain, persistence (schema, effect-schema, factory, migration), API routes plus `pnpm openapi:generate`, then `pnpm api:client:generate`, then the quality gates in `AGENTS.md`. | none |
