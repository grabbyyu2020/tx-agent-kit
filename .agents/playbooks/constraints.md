---
extends: feature, bug-fix, refactoring, perf-issue, hillclimb, opening-a-pr
when: Any task in this repository that writes or changes code, config, migrations, or tests.
---

# Project constraints

This repository keeps every coding constraint in the `project-constraints` skill (`.claude/skills/project-constraints/SKILL.md`). Each rule has an ID such as `WEB-03`. These changes make sure the rules reach you and every delegate before the first edit.

## Load the constraints before the first step

- **Before** "`how` over the affected subsystem." load the `project-constraints` skill. List the paths you expect to touch, read each reference its area table maps them to, and add a todo item `Constraints: <IDs>` naming the rules that apply.
- **Before** "Reproduce it yourself on the matching surface via the driver skill" load the `project-constraints` skill. List the paths you expect to touch, read each matching reference, and add a todo item `Constraints: <IDs>`.
- **Before** "Pin the behavior contract first." load the `project-constraints` skill. List the paths you expect to touch, read each matching reference, and add a todo item `Constraints: <IDs>`.
- **Before** "Capture a baseline trace via the matching driver skill." load the `project-constraints` skill. List the paths you expect to touch, read each matching reference, and add a todo item `Constraints: <IDs>`.
- **Before** "Ground the workload and architecture before choosing the metric." load the `project-constraints` skill. List the paths you expect to touch, read each matching reference, and add a todo item `Constraints: <IDs>`.

## Carry the constraints into every delegate brief

- **In** "Delegate code-writing to a subagent using your configured feature model" the brief names the `Constraints:` IDs and the absolute paths of their reference files, and tells the delegate to read them before any edit. Its success criteria include `pnpm lint:quiet`, `pnpm type-check:quiet`, and the affected tests passing in its worktree.
- **In** "Delegate implementation to a subagent using your configured bug-fix model" the brief names the `Constraints:` IDs and reference paths, tells the delegate to read them before any edit, and lists `pnpm lint:quiet` and `pnpm type-check:quiet` in its success criteria.
- **In** "Delegate the mechanical edits to a subagent using your configured refactoring model" the brief names the `Constraints:` IDs and reference paths, tells the delegate to read them before any edit, and lists `pnpm lint:quiet` and `pnpm type-check:quiet` in its success criteria.
- **In** "Delegate implementation to a subagent using your configured perf-issue model" the brief names the `Constraints:` IDs and reference paths, tells the delegate to read them before any edit, and lists `pnpm lint:quiet` and `pnpm type-check:quiet` in its success criteria.
- **In** "Hand the change to a subagent using your configured hillclimb model" the brief names the `Constraints:` IDs and reference paths, tells the delegate to read them before any edit, and lists `pnpm lint:quiet` and `pnpm type-check:quiet` in its success criteria.

## Create worktrees with the repository helper

- **In** "Give every file-writing delegate its own worktree" create it with `./scripts/worktree/create.sh <branch> <base>` from the repository root and hand the delegate the resulting `.worktrees/<name>` path. Never use `isolation: "worktree"`, `EnterWorktree`, or a raw `git worktree add`. They skip `scripts/worktree/setup.sh`, so the worktree has no `.env`, ports, or database schema and cannot run integration tests.
- **In** "When the delegate builds on commits the default branch lacks" pass the base commit as the second argument to `./scripts/worktree/create.sh` instead of running `git worktree add` yourself.
- **In** "fan them to parallel subagents, each in its own worktree" create each worktree with `./scripts/worktree/create.sh`.
- **In** "Work from a git worktree off main." create the worktree with `./scripts/worktree/create.sh <branch> main`.

## Run the repository quality gates when you verify

- **After** "Verify on the matching surface." run `pnpm lint:quiet && pnpm type-check:quiet && pnpm test:quiet` with `set -o pipefail`. When the change touches `apps/api`, `apps/web`, `apps/worker`, `packages/core`, or `packages/infra`, run `pnpm infra:ensure` and then `pnpm test:integration:quiet`. Check the diff against each rule in the `Constraints:` todo and name any you could not satisfy.
- **After** "Verify on the same surface." run the same gates and the same constraint check.
- **After** "Prove behavior is unchanged on the real artifact" run the same gates and the same constraint check.
- **After** "Parse and compare the artifacts" run the same gates and the same constraint check.
- **In** "Measure before and after with the frozen harness, and run the regression gate." the regression gate includes `pnpm lint:quiet` and `pnpm type-check:quiet`.

## Check CI after the push

- **After** "Post the URL and keep building." run `pnpm ci:check --watch` in the background for the pushed commit. Local integration runs cover only affected projects, so the work is not done until the full CI suite on the branch is green.
