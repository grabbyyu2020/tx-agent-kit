---
paths:
  - "**"
---

# Process constraints

How to work in this repository: instruction files, worktrees, branches, and slow test suites. These rules apply to every task, whatever paths it touches.

| ID | Rule | Enforced by |
|---|---|---|
| OPS-01 | Edit `AGENTS.md`, never `CLAUDE.md`. `CLAUDE.md` contains exactly `@AGENTS.md` so Claude Code and Amp read one instruction file. When `/setup-pstack` offers to add its `@pstack-models.md` include to the project's `CLAUDE.md`, put it in the user-level `~/.claude/CLAUDE.md` instead. | `script:scripts/lint/enforce-agent-workflow.mjs` |
| OPS-05 | Use the native worktrees pstack asks for: the Agent tool's `isolation: "worktree"`, `EnterWorktree`, or `git worktree add` when a delegate must start from a commit other than `HEAD`. `.claude/settings.json` sets `worktree.baseRef` to `head`, so Claude Code worktrees start from the current commit, without its uncommitted changes. `.worktreeinclude` copies `.env` and `.artifacts/local-infra.env` into worktrees that Claude Code creates. After `git worktree add`, copy those two files yourself. Run `pnpm install --frozen-lockfile` in a new worktree before any gate. Every worktree shares the primary checkout's ports, Temporal task queue, and database, so run dev servers and integration tests in one checkout at a time. | none |
| OPS-06 | Name branches `<type>/<domain>-<short-description>` with type `feat`, `fix`, `refactor`, `test`, or `chore`. One task per worktree. | none |
| OPS-08 | Do not run `pnpm test:integration:full` or `pnpm test:integration:ci-only` locally unless asked. They include slow suites that CI runs. | none |
