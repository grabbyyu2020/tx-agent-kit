---
paths:
  - "**"
---

# Global constraints

Apply to every source file in `apps/**` and `packages/**`, and to `scripts/**` where noted.

| ID | Rule | Enforced by |
|---|---|---|
| GLB-01 | No `console.*`. Log through `createLogger` from `@tx-agent-kit/logging`; logger names start with `tx-agent-kit-`. | `eslint:no-console`, `eslint:no-restricted-syntax` [createLogger prefix selector in `effect-consistency.js`, core/api/worker/infra src; the "use the logging package" half is review only] |
| GLB-02 | No `as any`, `<any>`, or chained `as unknown as` assertions in source. Narrow with Schema decode or type guards. | `script:scripts/lint/enforce-source-type-safety.mjs`, `eslint:@typescript-eslint/no-explicit-any` |
| GLB-03 | No empty or comment-only `catch` blocks. Handle, map, or rethrow the error. | `script:scripts/lint/enforce-source-type-safety.mjs` |
| GLB-04 | No `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or `eslint-disable` directives in source (tests and generated code excepted). | `script:scripts/lint/invariants/source-hygiene.mjs`, `eslint:@typescript-eslint/ban-ts-comment` |
| GLB-05 | No TODO, FIXME, or HACK comments. Fix the root cause now, or ask the user when it needs a design decision. | `eslint:no-deferred-work/no-todo-comments`, `script:scripts/lint/invariants/source-hygiene.mjs` |
| GLB-06 | Read `process.env` only in the dedicated env modules: `apps/api/src/config/*`, `apps/worker/src/config/env.ts`, `packages/*/src/env.ts`, and the web/mobile env modules. Everything else imports typed env from them. | `script:scripts/lint/invariants/source-hygiene.mjs` [partial: `apps/web` outside `src/` is not scanned] |
| GLB-07 | Env files live only at the repository root: `.env`, `.env.example`, `.env.tunnel`. | `script:scripts/lint/invariants/source-hygiene.mjs` |
| GLB-08 | Validate requests, responses, and external data with `effect/Schema`. zod, valibot, yup, joi, and superstruct are banned. | `eslint:no-restricted-imports` |
| GLB-09 | Only `packages/infra/db` imports `drizzle-orm`. | `eslint:no-restricted-imports`, `eslint:domain-structure/pure-domain-no-infra-imports` |
| GLB-10 | Import other workspace packages through `@tx-agent-kit/*` aliases, never relative paths across package roots. Respect package boundaries. | `eslint:boundaries/element-types`, `eslint:no-restricted-imports` |
| GLB-11 | A non-test, non-generated `.ts`/`.tsx` file has at most 500 non-blank, non-comment lines. Split by responsibility into a sibling module. Never compress formatting, delete meaningful code, raise the limit, or add an ignore. If no sensible split exists, ask the user. | `eslint:file-length/max-lines` |
| GLB-12 | Braces on every block; object shorthand, arrow callbacks, rest parameters, and spread over their older forms. | `eslint:curly`, `eslint:object-shorthand`, `eslint:prefer-arrow-callback`, `eslint:prefer-rest-params`, `eslint:prefer-spread` |
| GLB-13 | Use `node:` builtins, `.replaceAll()`, `.slice()`, `.flatMap()`, `.some()`, `structuredClone`, `Number.*` globals, numeric separators, `error` as the catch name, and optional catch bindings. No useless spreads or `Promise.resolve`/`reject` in async functions. | `eslint:unicorn/prefer-node-protocol`, `eslint:unicorn/prefer-string-replace-all`, `eslint:unicorn/prefer-string-slice`, `eslint:unicorn/prefer-array-flat-map`, `eslint:unicorn/prefer-array-some`, `eslint:unicorn/prefer-structured-clone`, `eslint:unicorn/prefer-number-properties`, `eslint:unicorn/numeric-separators-style`, `eslint:unicorn/catch-error-name`, `eslint:unicorn/prefer-optional-catch-binding`, `eslint:unicorn/no-useless-spread`, `eslint:unicorn/no-useless-promise-resolve-reject` |
| GLB-14 | No provably constant binary expressions. | `eslint:no-constant-binary-expression` |
| GLB-15 | No unused imports. | `eslint:unused-imports/no-unused-imports` |
| GLB-16 | Exhaustive `switch` over unions; optional chaining and `??` over manual checks; consistent type exports. | `eslint:@typescript-eslint/switch-exhaustiveness-check`, `eslint:@typescript-eslint/prefer-optional-chain`, `eslint:@typescript-eslint/prefer-nullish-coalescing`, `eslint:@typescript-eslint/consistent-type-exports` |
| GLB-17 | No compiled artifacts (`.js`, `.d.ts`, maps) under any `src/`. | `script:scripts/lint/invariants/source-hygiene.mjs` |
| GLB-18 | Magic numbers (timeouts, limits, batch sizes) live in `packages/contracts/src/constants.ts` and are imported from `@tx-agent-kit/contracts`. | none |
| GLB-19 | Shared string enums are tuples in `packages/contracts/src/literals.ts`. No inline string-union enums and no multi-value `Schema.Literal` enums outside it. | `eslint:domain-structure/no-inline-string-union-enums`, `eslint:domain-structure/no-raw-schema-literal-enums` |
| GLB-20 | No product-leak terms and no plaintext secrets. Secret values in env files, compose files, and workflows are blank, `op://` references, `${{ secrets.* }}`, or placeholders. | `script:scripts/lint/enforce-product-leak-and-secret-policy.mjs` |
| GLB-21 | Shell scripts under `scripts/` start with `set -euo pipefail`, are executable, and avoid `declare -A` (macOS bash 3.2). | `script:scripts/check-shell-invariants.sh` |
| GLB-22 | Duplication in `apps/api/src`, `packages/core/src`, and `scripts` stays under 5%. Extract shared code instead of copying. | `script:.jscpd.json` |
| GLB-23 | A new package is named `@tx-agent-kit/<name>`, lives in `packages/`, `packages/infra/`, or `packages/tooling/`, extends `tsconfig.node.json` at the right depth, uses `@tx-agent-kit/vitest-config`, has a `src/index.ts` barrel, and gets an alphabetized path alias in `tsconfig.base.json` plus an entry in the root `tsconfig.json` references. Run `pnpm install` after adding `workspace:*` dependencies. | `script:scripts/lint/enforce-tsconfig-alignment.mjs` [partial: aliases and references only] |
| GLB-24 | Never hand-edit generated files: `apps/api/openapi.json`, `apps/web/lib/api/generated/*`, `packages/contracts/src/agent-client-surface.generated.json`, and generated reconcile SQL under `packages/infra/db/schemas/`. Regenerate them (`pnpm api:client:generate`, `pnpm agent-surfaces:generate`, `pnpm permissions:sync`, `pnpm db:schemas:generate`). | `script:scripts/generate-agent-client-surfaces.ts`, `script:scripts/permissions-sync.mjs` [partial: `--check` covers agent surfaces and permissions only] |
