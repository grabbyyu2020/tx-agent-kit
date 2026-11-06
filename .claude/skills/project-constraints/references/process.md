---
paths:
  - "**"
---

# Process constraints

How to work in this repository: instruction files, worktrees, branches, and slow test suites. These rules apply to every task, whatever paths it touches.

| ID | Rule | Enforced by |
|---|---|---|
| OPS-01 | Edit `AGENTS.md`, never `CLAUDE.md`. `CLAUDE.md` contains exactly `@AGENTS.md` so Claude Code and Amp read one instruction file. When `/setup-pstack` offers to add its `@pstack-models.md` include to the project's `CLAUDE.md`, put it in the user-level `~/.claude/CLAUDE.md` instead. | `script:scripts/lint/enforce-agent-workflow.mjs` |
| OPS-05 | Create worktrees only with `./scripts/worktree/create.sh <branch> [base]` from the repository root, and remove them only with `./scripts/worktree/manage.sh remove <name> --yes`. Never use `git worktree add`, `git worktree remove`, `EnterWorktree`, or the Agent tool's `isolation: "worktree"`. They skip `scripts/worktree/setup.sh`, so the worktree has no `.env`, ports, Temporal task queue, or database schema, and removal leaks its dev processes and schema. This holds wherever a pstack skill or playbook says to create or prune a worktree, including `arena`, `swarm`, and `interrogate`, which project playbooks cannot rewrite. | none |
| OPS-06 | Name branches `<type>/<domain>-<short-description>` with type `feat`, `fix`, `refactor`, `test`, or `chore`. One task per worktree. | `script:scripts/worktree/create.sh` [partial: warns on a missing type prefix only] |
| OPS-08 | Do not run `pnpm test:integration:full` or `pnpm test:integration:ci-only` locally unless asked. They include slow suites that CI runs. | none |
