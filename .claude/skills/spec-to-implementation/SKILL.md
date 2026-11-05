---
name: spec-to-implementation
description: End-to-end spec implementation with agent swarms. Analyzes a design spec, identifies gaps, implements every tx task linked to the spec in dependency order with parallel sub-agents (TDD), then runs adversarial review-fix loops until clean. Use when a design doc exists and you need to build or complete the implementation.
argument-hint: <path-to-spec> [--phase gap-analysis|tdd|implement|review-fix|prevention] [--max-parallel N]
---

# Spec to Implementation

Automated spec-driven implementation pipeline. Takes a design doc, swarms agents to analyze gaps,
builds with TDD, then adversarial-reviews until no bugs remain.

## When to use

- A design spec exists in `specs/design/` and needs implementation
- Partial implementation exists and you need to identify + fill gaps
- Post-implementation hardening (adversarial review + fix loops)

## Pipeline Overview

```
Phase 1: Gap Analysis        →  5-10 sub-agents compare spec vs codebase
Phase 2: TDD                 →  Write failing tests for all gaps
Phase 3: Implementation      →  Task-graph mode: sub-agents implement every tx task in
                                dependency order, in waves (default when the spec has tasks);
                                otherwise vertical slices in worktrees
Phase 4: Adversarial Review  →  10-15 reviewers per worktree, fix loop
Phase 5: Prevention          →  Surface ESLint rules + test strategies
```

**Merge is NOT part of this pipeline.** Merging is a human-initiated action. This skill
produces worktrees with clean, reviewed code. The human (or a separate `/merge` command)
decides when and where to merge. This keeps the skill safe for `/loop` usage — it will
never auto-merge into any branch.

Each phase is independently runnable via the `--phase` argument. Without `--phase`, run all
phases sequentially.

## Runtime

- **Claude Code**: Use `/loop 10m /spec-to-implementation <spec-path>` for continuous
  review-fix cycles. Maximum runtime: **1-1.5 hours** (the loop auto-stops or use CronDelete).
  The loop is safe because no phase modifies `main` or any shared branch.
- **Codex / Amp / any agent with a sub-agent tool**: run Phase 3 in task-graph mode (below).
  The same procedure works in Claude Code with the Task tool.

---

## Phase 1: Gap Analysis

Determine what the spec requires vs what exists. Launch **5-10 sub-agents** in parallel,
each investigating a different dimension of the spec.

### Agent Allocation (scale with spec size)

| Spec sections | Agent count | Rationale |
|---------------|-------------|-----------|
| < 5 tables, < 10 routes | 5 agents | Small spec |
| 5-15 tables, 10-30 routes | 7 agents | Medium spec |
| > 15 tables, > 30 routes | 10 agents | Large spec |

### Standard Agent Roles

1. **DB Schema Agent** — Compare spec data model tables/columns/constraints against
   `packages/infra/db/src/schema.ts`. Check FKs, cascades, indexes, unique constraints.
2. **Domain Layer Agent** — Compare spec interfaces (ports, services, middleware) against
   `packages/core/src/domains/`. Check method signatures, missing ports, missing services.
3. **API Routes Agent** — Compare spec API routes against `apps/api/src/api.ts` and
   `apps/api/src/routes/`. Check endpoints, HTTP methods, status codes, request/response schemas.
4. **Contracts Agent** — Compare spec types/enums against `packages/contracts/src/`.
   Check schemas, literals, missing types.
5. **Tests Agent** — Compare spec verification requirements against test files. Check
   which REQ/INV IDs have tests, which are missing, test quality.
6. **Web Pages Agent** (if spec has UI) — Check `apps/web/` for pages/components required
   by the spec.
7. **Permissions Agent** (if spec has RBAC) — Check permission definitions, role assignments,
   middleware wiring.

### Output

Produce a **gap table**:
```
| Gap ID | Spec Section | What's Missing | Priority | Files Affected |
```

---

## Phase 2: TDD — Write Failing Tests

For each gap identified in Phase 1, write **failing integration tests first**.

In Task-Graph Mode (Phase 3) this phase is folded into each task: the task's sub-agent writes
its failing tests first, then the code. Run Phase 1 and Phase 2 separately only for specs
without tx tasks, or to find gaps in an existing implementation.

### Rules

- One test file per domain area (e.g., `tenancy-model.integration.test.ts`)
- Follow existing test patterns: `createDbAuthContext`, `requestJson`, `addMemberToOrg`
- Tag tests with `[INV-*]` IDs from the spec's invariants block
- Tests MUST fail initially (TDD red phase)
- Use `apps/api/src/*.integration.test.ts` for API tests
- Use `apps/web/app/**/*.integration.test.tsx` for React component tests

### Agent Strategy

Launch **1 agent per gap cluster** (group related gaps). Each agent:
1. Reads the spec section for its gaps
2. Reads existing test patterns in the repo
3. Writes failing tests in an isolated worktree
4. Runs `pnpm type-check` to verify tests compile (even if they'd fail at runtime)

---

## Phase 3: Implementation

Build the code to make tests pass.

If the spec's design doc has linked tx tasks (`tx task list --json` entries whose
`linkedDocs[].name` is the design doc or its plan), use **Task-Graph Mode**. Otherwise use the
vertical-slice worktree strategy below.

### Task-Graph Mode (default when tx tasks exist)

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

#### File Ownership

Before launching a wave, list the files each task will create or modify (from the task
description, the design doc's Component Inventory and Implementation Sequence). Two tasks
in the same wave must not touch the same file. Shared registration files
(`packages/contracts/src/index.ts`, `literals.ts`, `packages/core/src/index.ts`,
`apps/api/src/api.ts`, `server-lib.ts`, `apps/worker/src/workflows.ts`, `activities.ts`,
`resolve-dispatch.ts`, schema.ts, `.env.example`) are assigned to exactly one task per wave;
a conflicting task waits for the next wave even if it is ready. All sub-agents work in the
current checkout on the current branch: the dependency graph means later tasks need earlier
tasks' uncommitted-to-main code, so per-task worktrees from `main` do not work here.

#### Sub-Agent Brief

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

#### VERIFY (orchestrator, per task)

1. Read the sub-agent's diff (`git diff -- <owned files>`); reject edits outside its files.
2. Re-run its tests and type-check yourself; do not trust the report alone.
3. Check the acceptance criterion and the invariants named in the task are actually asserted.
4. If the design must change, update the design doc (and plan doc), `tx doc sync` both, and
   tell later sub-agents.
5. Commit only that task's files: `git add <files> && git commit -m "feat(<scope>): <title>"`
   with a `Task: <id>` trailer, then `tx task done <id>`.

#### Rules

- Never mark a task done before VERIFY passes.
- Never start a task whose blockers are not done; `tx task ready` already enforces this.
- If a sub-agent discovers new work, the orchestrator adds it with
  `tx task add ... --description "Acceptance: ..."`, `tx doc attach <id> <plan>` and
  `tx task dep block` so it enters the graph.
- Report progress to the user after each wave: tasks done, tasks blocked, next wave.

### Vertical-Slice Mode (no tx tasks)

Use the `/worktree` skill conventions.

#### Agent Strategy

Launch **1 agent per vertical slice** in isolated worktrees. A vertical slice is:
contracts + domain + ports + adapters + service + API route + handler.

Each agent:
1. Works in its own worktree (branch: `feat/<domain>-<feature>`)
2. Implements bottom-up: DB schema/migration → effect schemas → domain types → ports →
   adapters → service → API endpoint → route handler → mapper
3. Runs `pnpm type-check` (MUST pass before signaling done)
4. Does NOT run integration tests (deferred to post-merge)

#### File Ownership Declaration

**CRITICAL**: To prevent merge conflicts, the orchestrator MUST declare file ownership
for each agent upfront. No two agents should create or modify the same file.

```
Agent 1 (team-members): owns packages/core/src/domains/team/, apps/api/src/routes/teams.ts
Agent 2 (roles-crud):   owns packages/core/src/domains/role/, apps/api/src/routes/roles.ts
Agent 3 (invitations):  owns packages/infra/db/src/repositories/invitations.ts
```

If two agents need the same file (e.g., `apps/api/src/api.ts` for endpoint registration),
assign one agent as the owner and have the other agent document what needs to be added
(the orchestrator merges manually).

#### Worktree Safety Rules

Per `/worktree` skill:
- One task per worktree
- Branch from `main`
- No `pnpm dev` or `pnpm test:integration` (port conflicts)
- `pnpm type-check` is safe in parallel
- Commit before signaling done

---

## Phase 4: Adversarial Review-Fix Loop

The core hardening phase. For each worktree, launch **10-15 adversarial reviewers**.

### Reviewer Roles (per worktree)

| # | Role | What it checks |
|---|------|----------------|
| 1 | **Security Reviewer** | Auth bypass, injection, IDOR, missing permission checks |
| 2 | **Logic Reviewer** | Race conditions, null handling, incorrect status codes, edge cases |
| 3 | **Contract Reviewer** | Schema mismatches, request/response shape correctness |
| 4 | **Test Coverage Reviewer** | Missing test cases, untested error paths, missing edge cases |
| 5 | **DDD Pattern Reviewer** | Correct layer boundaries, dependency direction, port/adapter alignment |
| 6 | **DB Safety Reviewer** | FK cascades, migration safety, constraint correctness, N+1 queries |
| 7 | **Error Handling Reviewer** | Swallowed errors, wrong error codes, missing error mapping |
| 8 | **Concurrency Reviewer** | Race conditions, unique constraint handling, idempotency |
| 9 | **API Contract Reviewer** | OpenAPI spec accuracy, pagination correctness, consistent naming |
| 10 | **Cross-Worktree Reviewer** | Merge conflicts, duplicate domain files, overlapping exports |

Scale to 15 reviewers for large worktrees (> 10 files changed) by adding:
- Performance Reviewer (N+1 queries, missing indexes, unbounded queries)
- Accessibility Reviewer (for web pages — aria labels, semantic HTML)
- Observability Reviewer (missing logging, tracing, error reporting)
- Backward Compat Reviewer (breaking changes to existing APIs/schemas)
- Config/Env Reviewer (hardcoded values, missing env vars, secret leaks)

### Review-Fix Loop

```
while (criticalIssues > 0) {
  1. Compile all reviewer findings → consolidated bug report
  2. Categorize: CRITICAL / IMPORTANT / LOW
  3. Launch fix agents (1 per worktree with criticals)
  4. Wait for fixes
  5. Re-review fixed worktrees (launch new reviewers)
  6. Repeat until zero criticals
}
```

**Maximum iterations**: 3 loops. If criticals remain after 3 loops, escalate to human.

### Using /loop for the review-fix cycle

```
/loop 10m Check progress on fix agents. For completed fixes: re-review the diff for
correctness. If new issues found, launch follow-up fix agents. Track remaining criticals.
Once all criticals resolved, compile final report and stop.
```

Maximum loop runtime: **1-1.5 hours**. Use `CronDelete <job-id>` to stop early.

---

## Phase 5: Prevention

After all criticals are fixed and merged, surface systemic improvements that would have
caught the bugs earlier.

### What to Surface

1. **ESLint rules** — Should a new rule in `packages/tooling/eslint-config/` catch this class
   of bug? (e.g., `enforce-tenant-scope`, `no-swallowed-errors`, `enforce-auth-principal-usage`)
2. **Structural lint scripts** — Should a new script in `scripts/lint/enforce-*.mjs` prevent
   this? (e.g., `enforce-auth-on-mutations.mjs`)
3. **pgTAP tests** — Should DB-level constraints be tested in `packages/infra/db/pgtap/`?
4. **Test patterns** — Should a new test helper or factory be added to `packages/testkit/`?
   (e.g., `createTeamWithMembers`, `expectForbidden`)
5. **Architecture guards** — Should the `/worktree` or `/new-integration-test` skill be
   updated?

### Prevention must be actionable

Don't just list recommendations — **implement them** as part of this phase:
- Write the ESLint rule + test
- Write the testkit factory
- Add the pgTAP test
- Update the skill files

---

## Loop Behavior (Claude Code + Codex)

This skill is designed to run in `/loop`. Each invocation is **idempotent** — it checks
current state, identifies remaining gaps/bugs, fixes them, and reports. It never merges.

### Auto-Stop Condition

**When zero critical issues remain, the skill reports "CLEAN" and the loop should stop.**

The orchestrator (Claude Code or Codex) should:
1. Run the review-fix phase
2. If criticals found → fix → re-review
3. If zero criticals → report final status → `CronDelete <job-id>` to stop the loop
4. Maximum runtime: **1-1.5 hours** (hard cap, stop even if issues remain)

### Multi-Pass Trust Model

Don't trust the first pass. The loop enables multi-pass verification:

```
Pass 1: Gap analysis + TDD + implement
Pass 2: Adversarial review (10-15 agents) → find bugs
Pass 3: Fix bugs → re-review → find more bugs
Pass 4: Fix remaining → re-review → zero criticals → STOP
```

Each `/loop` iteration runs one pass of review-fix. Multiple iterations compound into
a high-confidence result.

### Claude Code

```bash
# Full pipeline (one-shot)
/spec-to-implementation specs/design/tenancy-model-design.md

# Review-fix loop (multi-pass, auto-stops when clean)
/loop 10m /spec-to-implementation specs/design/tenancy-model-design.md --phase review-fix

# Gap analysis only
/spec-to-implementation specs/design/tenancy-model-design.md --phase gap-analysis
```

### Task-graph mode (any runtime with sub-agents)

```bash
# Implement every tx task linked to the spec, in dependency order, with parallel sub-agents
/spec-to-implementation specs/design/youtube-shadowing-design.md --phase implement --max-parallel 4
```

If the spec has no tasks yet, create them first (see the `tx-plan` and `tx-tasks` skills):

```bash
tx doc add plan <name>-plan --title "<Name> implementation plan"
tx doc link <name>-design <name>-plan && tx doc sync <name>-plan
tx task add "<step>" --description "Acceptance: ..."
tx doc attach <task-id> <name>-plan
tx task dep block <dependent-id> <blocker-id>
```
