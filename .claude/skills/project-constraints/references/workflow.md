---
paths:
  - "**"
---

# Workflow constraints

How to work in this repository. Nothing mechanical enforces these rules, so follow them deliberately.

| ID | Rule | Enforced by |
|---|---|---|
| FLOW-01 | Create worktrees only with `./scripts/worktree/create.sh <branch> [base]` from the repository root; it runs `scripts/worktree/setup.sh` for env, ports, Temporal task queue, and database schema. Never use `git worktree add`, `EnterWorktree`, or the Agent tool's `isolation: "worktree"`. Name branches `<type>/<domain>-<short-description>` (`feat`, `fix`, `refactor`, `test`, `chore`). One task per worktree. | none |
| FLOW-02 | Start services with `pnpm dev` (or `pnpm dev:api`, `pnpm dev:web`, `pnpm dev:worker` once infra is up). Never start services with inline env vars. Secrets come from `.env` through `op://` references. If a needed dev server is not running, start it. | none |
| FLOW-03 | Docker infrastructure is shared across worktrees under the `tx-agent-kit` project name. Run `pnpm infra:ensure`; never modify or tear it down. | none |
| FLOW-04 | Before reporting done, run `pnpm lint:quiet && pnpm type-check:quiet && pnpm test:quiet`, and `pnpm test:integration:quiet` when the change touches api, web, worker, core, or infra. Local integration runs only affected projects (`--plan` shows the decision; `TX_INTEGRATION_FULL=1` forces all). When piping a gate through `grep`/`head`/`tail`, use `set -o pipefail`. Do not run `pnpm test:integration:full` or `:ci-only` locally unless asked. | none |
| FLOW-05 | After pushing, run `pnpm ci:check --watch` and fix any failing job. The full suite runs only in CI. | none |
| FLOW-06 | Never bypass hooks or checks: no `git commit --no-verify` or `-n`, no lowered lint severity, no new lint ignores. | none |
| FLOW-07 | Feature path for a new entity: `pnpm scaffold:crud --domain <d> --entity <e> --dry-run`, then contracts (`effect/Schema`), core domain, persistence (schema, effect-schema, factory, migration), API routes plus `pnpm openapi:generate`, then `pnpm api:client:generate`, then the FLOW-04 gates. | none |
| FLOW-08 | All AI calls (text, structured output, images, embeddings) route through OpenRouter, and cost comes from OpenRouter's response. Custom credit math exists only for non-OpenRouter providers (fal.ai, Veo3, ElevenLabs). | none |
| FLOW-09 | When a rule here or in another reference is broken twice, encode it as a lint or script check and update its `Enforced by` cell. | none |
