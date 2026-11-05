---
name: spec-to-implementation
description: End-to-end spec implementation with agent swarms. Analyzes a design spec, identifies gaps, implements every tx task linked to the spec in dependency order with parallel sub-agents (TDD), then runs adversarial review-fix loops until clean.
metadata:
  short-description: Spec-driven implementation pipeline with adversarial review
---

# Spec to Implementation

Automated spec-driven implementation pipeline. Takes a design doc, analyzes gaps, builds with
TDD, then adversarial-reviews until no bugs remain. Never merges — produces clean worktrees.

## Pipeline

```
Phase 1: Gap Analysis        →  5-10 sub-agents compare spec vs codebase
Phase 2: TDD                 →  Write failing tests for all gaps
Phase 3: Implementation      →  Task-graph mode: sub-agents implement every tx task in
                                dependency order, in waves (default when the spec has tasks);
                                otherwise vertical slices in worktrees
Phase 4: Adversarial Review  →  10-15 reviewers per worktree, fix loop
Phase 5: Prevention          →  Surface ESLint rules + test strategies
```

**No merge phase.** This skill produces clean worktrees. Merging is human-initiated.

## Loop Behavior

Designed for multi-pass `/loop` usage. Each invocation is idempotent:
1. Check current state, identify remaining gaps/bugs
2. Fix them, re-review
3. **When zero criticals remain → report CLEAN → stop the loop**
4. Maximum runtime: 1-1.5 hours (hard cap)

### Multi-Pass Trust Model

Don't trust the first pass:
```
Pass 1: Gap analysis + TDD + implement
Pass 2: Adversarial review → find bugs
Pass 3: Fix bugs → re-review → find more bugs
Pass 4: Fix remaining → re-review → zero criticals → STOP
```

If the spec's design doc has linked tx tasks (`tx task list --json` entries whose
`linkedDocs[].name` is the design doc or its plan), Phase 3 runs in Task-Graph Mode; the TDD
phase is folded into each task's sub-agent. Without tasks, create them first (`tx-plan` and
`tx-tasks` skills: `tx doc add plan`, `tx doc link`, `tx task add`, `tx doc attach`,
`tx task dep block`).

## Task-Graph Mode (default when tx tasks exist)

The orchestrator (you) owns the queue, the shared files, verification and commits. Sub-agents
implement one task each. Work proceeds in **waves**: every wave runs all currently ready tasks
in scope that can run together, and the next wave starts only after the previous wave is
verified, because tasks unblocked by it depend on its code.

```
SETUP
  tx doc show <design> --md; tx doc show <plan> --md
  SCOPE = ids from `tx task list --json` whose linkedDocs include <design> or <plan>
  Abort if any SCOPE task depends on a task outside SCOPE that is not done.

LOOP
  READY = `tx task ready -n 100 --json` ∩ SCOPE, status not active/blocked
  if READY empty:
      if every SCOPE task is done → go to FINISH
      else → report the blocked tasks and their blockers to the user; stop
  WAVE = pick from READY by score, up to --max-parallel (default 4), such that
         no two tasks write the same file (see File Ownership)
  for each task in WAVE: tx task update <id> --status active
  launch one sub-agent per task IN PARALLEL (same turn), each with the brief below
  wait for all sub-agents
  for each finished task: VERIFY (below)
      pass → commit its files, tx task done <id>
      fail → send the failure back to the same sub-agent once; re-VERIFY
             still failing → tx task update <id> --status blocked, add a note to the
             description with the failure, continue with independent tasks
  run the wave gate: pnpm type-check:quiet && pnpm lint:quiet && pnpm test:quiet,
      plus pnpm test:integration:quiet if the wave touched integration-tested code
  wave gate red → fix (yourself or a fix sub-agent) before starting the next wave
  repeat LOOP

FINISH
  pnpm lint && pnpm type-check && pnpm test && pnpm test:integration:quiet
  continue with Phase 4 (adversarial review) on the combined diff, then the
  verify-invariants skill for spec evidence
```

### File Ownership

Before launching a wave, list the files each task will create or modify (from the task
description, the design doc's Component Inventory and Implementation Sequence). Two tasks
in the same wave must not touch the same file. Shared registration files
(`packages/contracts/src/index.ts`, `literals.ts`, `packages/core/src/index.ts`,
`apps/api/src/api.ts`, `server-lib.ts`, `apps/worker/src/workflows.ts`, `activities.ts`,
`resolve-dispatch.ts`, schema.ts, `.env.example`) are assigned to exactly one task per wave;
a conflicting task waits for the next wave even if it is ready. All sub-agents work in the
current checkout on the current branch: the dependency graph means later tasks need earlier
tasks' uncommitted-to-main code, so per-task worktrees from `main` do not work here.

### Sub-Agent Brief

Each sub-agent gets a self-contained prompt (it has not seen the conversation):

- The task id, title and full description (`tx task show <id> --json`), and the acceptance
  criterion it must meet.
- The design doc path and the exact sections and invariant ids that apply; the plan doc path.
- The files it owns, and the files it must not edit (everything else, especially other
  wave members' files and the shared files it does not own).
- Repo rules to follow: TDD (write the failing test first, test names tagged `[INV-*]`),
  `AGENTS.md`, and the relevant skill (`new-domain-event`, `new-migration`,
  `domain-driven-design`, `new-integration-test`, `playwright-cli` for UI screenshots).
- Checks to run before reporting: type-check and unit tests for the touched packages, and the
  task's own integration test file only if the orchestrator gave it the wave's single
  integration slot (concurrent integration runs share one API server per checkout).
- Do not run `tx` commands, do not commit, do not touch git state.
- Final message: files changed, tests added (with names), commands run with their decisive
  output, anything not done, and any deviation from the design doc with the reason.

### VERIFY (orchestrator, per task)

1. Read the sub-agent's diff (`git diff -- <owned files>`); reject edits outside its files.
2. Re-run its tests and type-check yourself; do not trust the report alone.
3. Check the acceptance criterion and the invariants named in the task are actually asserted.
4. If the design must change, update the design doc (and plan doc), `tx doc sync` both, and
   tell later sub-agents.
5. Commit only that task's files: `git add <files> && git commit -m "feat(<scope>): <title>"`
   with a `Task: <id>` trailer, then `tx task done <id>`.

### Rules

- Never mark a task done before VERIFY passes.
- Never start a task whose blockers are not done; `tx task ready` already enforces this.
- If a sub-agent discovers new work, the orchestrator adds it with
  `tx task add ... --description "Acceptance: ..."`, `tx doc attach <id> <plan>` and
  `tx task dep block` so it enters the graph.
- Report progress to the user after each wave: tasks done, tasks blocked, next wave.
