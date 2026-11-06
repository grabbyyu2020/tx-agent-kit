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
- **In** "`architect` for parallel design exploration." every runner brief names the `Constraints:` IDs and reference paths, and a sketch that breaks one of those rules loses.
- **In** "If it crosses a function boundary, `architect` first." every runner brief names the `Constraints:` IDs and reference paths, and a sketch that breaks one of those rules loses.
- **In** "If the target crosses a function boundary, run the **architect** skill for parallel design exploration of the shape before the move." every runner brief names the `Constraints:` IDs and reference paths, and a sketch that breaks one of those rules loses.
- **In** "If the design is contested, `interrogate` before shipping." every adversary brief names the `Constraints:` IDs and reference paths, so a broken rule counts as a finding.

## Land a bug's failing test first

- **Replace** "Skip it when the test would be expensive, integration-heavy, or unclear." with "Skip it only when neither the API harness (TEST-07) nor the web harness (TEST-08) reaches the behavior, and then commit a failing repro script before the fix (TEST-01)."

## Run the quality gates before the PR

- **After** "Run `/deslop` over the diff before commit and `/no-comments` before review." run `pnpm lint:quiet`, `pnpm type-check:quiet`, `pnpm test:quiet`, and `pnpm test:integration:quiet` in the worktree you will ship (OPS-08), and check the diff against every rule on the `Constraints:` line (project-constraints step 5). Run them after both passes, because `/no-comments` can delete comments a tool reads, such as `@vitest-environment` or `ALLOW_HARDCODED_TEST_EMAIL`, and the gates are what catch it. Restore a deleted directive the gates need, and fix every other failure before you open the PR.
