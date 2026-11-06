---
extends: feature, bug-fix, refactoring, perf-issue, hillclimb, opening-a-pr, autopilot-full, orchestrate, multi-phase-plan, worktree-cleanup
when: Any task in this repository that writes or changes code, config, migrations, or tests, or that creates or prunes worktrees.
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

## Write the failing test first

- **Replace** "Skip it when the test would be expensive, integration-heavy, or unclear." with "Skip it only when neither the API harness (TEST-07) nor the web harness (TEST-08) reaches the behavior, and then commit a failing repro script before the fix (TEST-01)."

## Create and remove worktrees with the repository helpers

- **In** "Give every file-writing delegate its own worktree" create it with `./scripts/worktree/create.sh <branch> <base>` from the repository root (OPS-05) and hand the delegate the resulting `.worktrees/<name>` path.
- **In** "When the delegate builds on commits the default branch lacks" pass the base commit as the second argument to `./scripts/worktree/create.sh` instead of running `git worktree add` yourself.
- **In** "fan them to parallel subagents, each in its own worktree" create each worktree with `./scripts/worktree/create.sh`.
- **In** "Work from a git worktree off main." create the worktree with `./scripts/worktree/create.sh <branch> main`.
- **In** "Each owner is a background subagent in its own worktree" create each owner's worktree with `./scripts/worktree/create.sh` and hand the owner its `.worktrees/<name>` path.
- **In** "give each writer its own worktree or branch" create each writer's worktree with `./scripts/worktree/create.sh`.
- **In** "Each live lane runs in its own worktree at the PR head." create each lane's worktree with `./scripts/worktree/create.sh <lane-branch> <pr-head>`.
- **Replace** "Per path, `git worktree remove --force <path>`." with "Per worktree under `.worktrees/`, run `./scripts/worktree/manage.sh remove <name> --yes`, which stops its dev processes and drops its database schema (OPS-05)."
