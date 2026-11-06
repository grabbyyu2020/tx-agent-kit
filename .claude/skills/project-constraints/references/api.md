---
paths:
  - "apps/api/**"
---

# API constraints (`apps/api`)

`apps/api` is an Effect HttpApi server. Routes are thin: they authenticate, call a core application service, and map the result.

| ID | Rule | Enforced by |
|---|---|---|
| API-01 | `apps/api` never imports `@temporalio/*`. Work for the worker goes through the domain-event outbox. Only `apps/api/src/adapters/temporal-control.ts` may use the Temporal client. | `eslint:no-restricted-imports` [shadowed for `apps/api/src/routes/**`] |
| API-02 | A route file that uses domain services authenticates with `requireAuth`, `requireTeamAuth`, or `requireOrgAuth`, never with `TeamAuthMiddleware`/`OrgAuthMiddleware` directly. | `eslint:domain-structure/require-auth-middleware-in-routes`, `eslint:domain-structure/enforce-auth-helper-usage` |
| API-03 | Each route file declares exactly one `<Name>RouteKind` of `'crud'` or `'custom'`. `crud` means the full list/get/create/update/remove set, and the kind matches the domain's repository kind. | `script:scripts/lint/enforce-route-kind-contracts.mjs` |
| API-04 | Map failures through `CoreError` and translate to HTTP with `mapCoreError`. A message that starts with "Failed to" is an `internalError`, never a 4xx helper. | `eslint:no-restricted-syntax` ["Failed to" selector in `effect-consistency.js`] |
| API-05 | No `Effect.promise` and no `new Promise()`; wrap promises with `Effect.tryPromise`. | `eslint:no-restricted-syntax` [`effect-consistency.js`] |
| API-06 | `toApi<X>` mappers in `apps/api/src/mappers/` return every field of the matching contract schema. | `script:scripts/lint/invariants/api-mapper-coverage.mjs` |
| API-07 | Port adapters that import `@tx-agent-kit/db` or storage live in `packages/core`, not `apps/api/src/adapters`. | `eslint:domain-structure/no-api-layer-adapters` |
| API-08 | No `*-service.ts` outside `domains/`, and no default exports in api domains or routes. | `script:scripts/lint/invariants/domain-structure.mjs` |
| API-09 | Do not call `Effect.run*` inside route handlers; return the Effect. | none [ESLint selector is shadowed] |
| API-10 | `apps/api/openapi.json` is generated from `apps/api` and carries the closed DDD invariants (`x-ddd`, per-route `x-invariants`). After changing routes or contracts, run `pnpm openapi:generate` (or `pnpm api:client:generate` to refresh clients too). | `script:scripts/lint/invariants/web-api-contracts.mjs` [partial: existence only] |
| API-11 | Read env only through `apps/api/src/config/*`. A new runtime env key also goes into `.env.example` and `deploy/env/{staging,prod}.env.template`. | `script:scripts/lint/invariants/source-hygiene.mjs`, `script:scripts/lint/enforce-compose-runtime-contracts.mjs` |
| API-12 | Inside `Effect.gen`, iterate with `Effect.forEach`, not `for…of` with `yield*`. | `eslint:domain-structure/prefer-effect-foreach-in-gen` [warning; `--max-warnings=0` makes it fail] |
| API-13 | Error mapping keeps the original error (`Effect.tryPromise`/`Effect.mapError` handlers reference it). | `eslint:domain-structure/no-swallowed-errors` |
