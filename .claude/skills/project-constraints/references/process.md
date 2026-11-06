---
paths:
  - "**"
---

# Process constraints

How to work in this repository: instruction files, dev servers, worktrees, gates, and CI. These rules apply to every task, whatever paths it touches.

| ID | Rule | Enforced by |
|---|---|---|
| OPS-01 | Edit `AGENTS.md`, never `CLAUDE.md`. `CLAUDE.md` contains exactly `@AGENTS.md` so Claude Code and Amp read one instruction file. | `script:scripts/lint/enforce-agent-workflow.mjs` |
| OPS-02 | Never hand-edit the pstack skills in `.claude/skills/` or its subagents in `.claude/agents/`. Change `.skill-sources/` and run `pnpm pstack:sync`. | `script:scripts/lint/enforce-agent-workflow.mjs` |
| OPS-03 | Start services with `pnpm dev`, or `pnpm dev:api`, `pnpm dev:web`, and `pnpm dev:worker` once infra is up. Never start them with inline env vars. Secrets come from `.env` through `op://` references. | none |
| OPS-04 | If a dev server you need is not running, start it without asking. | none |
| OPS-05 | Create worktrees only with `./scripts/worktree/create.sh <branch> [base]` from the repository root. Never use `git worktree add`, `EnterWorktree`, or the Agent tool's `isolation: "worktree"`. They skip `scripts/worktree/setup.sh`, so the worktree has no `.env`, ports, Temporal task queue, or database schema. | none |
| OPS-06 | Name branches `<type>/<domain>-<short-description>` with type `feat`, `fix`, `refactor`, `test`, or `chore`. One task per worktree. | `script:scripts/worktree/create.sh` [partial: warns on a missing type prefix only] |
| OPS-07 | When piping a gate through `grep`, `head`, or `tail`, use `set -o pipefail`. | none |
| OPS-08 | Do not run `pnpm test:integration:full` or `pnpm test:integration:ci-only` locally unless asked. They include slow suites that CI runs. | none |
| OPS-09 | After pushing, run `pnpm ci:check --watch` and fix failing jobs before calling the work done. Local integration runs cover only affected projects; CI runs the full suite. | none |
