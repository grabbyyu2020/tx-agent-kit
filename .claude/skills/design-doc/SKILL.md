---
name: design-doc
description: Generate a detailed design document via `tx doc add design`. Covers architecture, interfaces, data model, invariants, failure modes, verification, and testing strategy. References plan via file path instead of embedding. Plan lives in ~/.claude/plans/<name>.md. Reads companion PRD automatically to map EARS requirements to invariants. Output lands in specs/design/<name>.md.
argument-hint: <feature-or-component-name>
---

# Generate Design Document

Create a comprehensive technical design document using the tx doc primitive. Design docs specify HOW the system implements requirements, with traceable invariants and a concrete testing strategy.

**Design Doc + PRD are companions.** A PRD defines WHAT and WHY. A design doc defines HOW. If a PRD exists for this feature, the design doc reads it automatically and maps every `must`-priority EARS requirement to an invariant + verification entry.

## Workflow State Machine

```
START
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 0: PLAN GATE                                    │
│                                                      │
│ Is there an active plan in this conversation?        │
│                                                      │
│ ├─ YES → Save plan to `~/.claude/plans/<name>.md` if not       │
│ │        already saved. Set `plan: ~/.claude/plans/<name>.md`  │
│ │        in frontmatter.                             │
│ │        → Continue to Step 0.5                      │
│ │                                                    │
│ └─ NO  → Tell the user to run /plan first.           │
│          If enough detail provided, generate plan,   │
│          save to `~/.claude/plans/<name>.md`.                  │
│          → Continue to Step 0.5                      │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 0.5: CHECK FOR COMPANION PRD                    │
│                                                      │
│ Run: tx doc list --kind prd                          │
│                                                      │
│ ├─ PRD exists for this feature?                      │
│ │   → tx doc show <prd-name> --md                    │
│ │   → Extract ALL EARS requirements                  │
│ │   → Each `must` EARS req MUST get an invariant     │
│ │     and a verification entry in this design doc    │
│ │   → Set `implements: <prd-name>` in frontmatter   │
│ │   → Continue to Step 1                             │
│ │                                                    │
│ └─ No companion PRD?                                 │
│     → Continue to Step 1 (design doc stands alone)   │
│     → Suggest creating PRD after: /prd <name>        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: SCAFFOLD via tx                              │
│                                                      │
│ tx doc add design <name> --title "<title>"           │
│ ├─ SUCCESS → Continue                                │
│ └─ FAIL (exists) → Edit existing doc                 │
│                                                      │
│ Save the plan as a tx plan doc (see tx-plan skill):  │
│ tx doc add plan <name>-plan --title "<title> plan"   │
│ tx doc link <name> <name>-plan                       │
│ → Continue to Step 2                                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: DEEP CONTEXT GATHERING                       │
│                                                      │
│ Read: ARCHITECTURE.md, QUALITY.md, CLAUDE.md,        │
│       domain code, schema.ts, effect-schemas,        │
│       API routes, workflows, activities,             │
│       existing designs (tx doc list --kind design)   │
│ → Continue to Step 3                                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: FILL DOCUMENT                                │
│                                                      │
│ Write `# Plan` first (reference to plan file from     │
│ Step 0).                                             │
│ Then fill all sections from plan + PRD + codebase.   │
│                                                      │
│ MINIMUM THRESHOLDS:                                  │
│   - Invariants: ≥ 5                                  │
│   - Failure modes: ≥ 3                               │
│   - Verification entries: ≥ 5                        │
│   - Integration test files: ≥ 2 (HARD REQUIREMENT)   │
│   - Unit test files: ≥ 1 (recommended, not hard)     │
│   - Sequence diagrams: ≥ 2 (happy + error)           │
│   - Design decisions: ≥ 1 (in the doc itself)        │
│                                                      │
│ Integration tests are the primary verification       │
│ mechanism. Unit tests complement but do not replace   │
│ integration tests.                                   │
│                                                      │
│ RULE: No section may be left as a template/stub.     │
│                                                      │
│ COMPREHENSIVENESS: The design doc must cover EVERY   │
│ item from the plan. Every implementation step,       │
│ constraint, risk, and decision in the plan must      │
│ appear in the design doc with full technical detail.  │
│ The design doc is the single source of truth for HOW │
│ the feature is built — it should be detailed enough  │
│ that an engineer can implement from it alone.        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: SELF-AUDIT                                   │
│                                                      │
│ Check:                                               │
│ ├─ Every plan item captured in a section?            │
│ ├─ Every PRD `must` EARS req has an invariant?       │
│ ├─ Every invariant has ≥ 1 `verified_by` test path?  │
│ ├─ Every REQ-* has a verification entry?             │
│ ├─ Minimums met?                                     │
│ ├─ No stubs/placeholders?                            │
│ ├─ All diagrams complete?                            │
│ └─ Plan file exists at frontmatter path and is       │
│    consistent with doc sections?                     │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: VALIDATE                                     │
│                                                      │
│ tx doc sync <name>                                   │
│ tx spec lint                                         │
│ ├─ PASS → Continue to Step 5.5                       │
│ └─ WARN/FAIL → Fix, re-validate                     │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5.5: SYNC PLAN FILE                             │
│                                                      │
│ Read the plan file from frontmatter `plan:` path.    │
│ Compare with what the doc now contains.              │
│ UPDATE the plan file to incorporate:                 │
│   - Architecture decisions, component inventory      │
│   - Interface contracts, data model details          │
│   - Invariants, failure modes, error handling        │
│   - Implementation sequence, testing strategy        │
│ The plan file must reflect the FULL current state    │
│ of the feature — not just the initial draft.         │
│ Copy the updated plan into the tx plan doc, then     │
│ tx doc sync <name>-plan                              │
│ This is a MANDATORY step, not optional.              │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: DISCOVER + LINK + REPORT                     │
│                                                      │
│ tx spec discover --doc <name>                        │
│ tx doc link <prd> <design> (if PRD exists)           │
│ tx doc show <name>                                   │
│ tx spec gaps --doc <name>                            │
│ Print summary                                        │
└─────────────────────────────────────────────────────┘
  │
  ▼
DONE
```

## Step 0 — Plan Gate

**The plan is the primary input.** Check for plan content in the conversation:

- The plan is saved as a standalone file at `~/.claude/plans/<name>.md` (relative to repo root).
- If a plan already exists in the conversation, write it to that file.
- If a plan file already exists at that path, read it instead.
- If no plan and vague request, ask user to run `/plan` first.

The doc's frontmatter gets `plan: ~/.claude/plans/<name>.md` and the `# Plan` section contains a reference link + brief summary, not the full verbatim content. The plan is also saved as a tx plan doc in Step 1.

## Step 0.5 — Check for Companion PRD

```bash
tx doc list --kind prd
```

If a PRD exists for this feature:
1. Read it: `tx doc show <prd-name> --md`
2. Extract every EARS requirement
3. Every `must`-priority EARS requirement MUST become:
   - An invariant in `invariants:` YAML block
   - A verification entry in `verification:` YAML block
4. Set `implements: <prd-name>` in frontmatter

If no PRD exists, the design doc stands alone. Suggest creating one after.

## Step 1 — Scaffold via tx

```bash
tx doc add design $ARGUMENTS --title "<Human-Readable Title>"
```

Creates `specs/design/<name>.md`. If exists, edit instead.

Then save the plan as a tx plan doc and link it to the design (full procedure: `.claude/skills/tx-plan/SKILL.md`):

```bash
tx doc add plan <name>-plan --title "<Human-Readable Title> plan"
tx doc link <name> <name>-plan
```

Copy the plan from `~/.claude/plans/<name>.md` verbatim below the tx-generated frontmatter of `specs/plan/<name>-plan.md` (replace the scaffold body, keep the frontmatter), add an adjacent `<name>-plan.source` symlink to the plan file's absolute path, then run `tx doc sync <name>-plan`. If the plan doc already exists, update it instead.

## Step 2 — Deep Context Gathering

Read these files:

- `docs/ARCHITECTURE.md` — architecture + DDD structure
- `docs/QUALITY.md` — all invariants, governance rules
- `CLAUDE.md` — stack, conventions
- Companion PRD (from Step 0.5)
- Domain code: `packages/core/src/domains/`
- Database schema: `packages/infra/db/src/schema.ts`
- Effect schemas: `packages/infra/db/src/effect-schemas/`
- API routes: `apps/api/src/`
- Workflows: `apps/worker/src/workflows.ts`
- Activities: `apps/worker/src/activities.ts`
- Existing designs: `tx doc list --kind design`

## Step 3 — Fill the Document

### Required Frontmatter (already generated by tx)

```yaml
---
kind: spec
spec_type: design
doc_id: <generated by tx — never edit or remove>
name: <name>
title: "<title>"
status: draft
version: 1
owners:
  - <team-or-person>
summary: Technical approach for <title>
domain: <product-area>
tags:
  - design
depends_on: []
supersedes: []
implements: <prd-name-or-null>
last_reviewed_at: <YYYY-MM-DD>
plan: ~/.claude/plans/<name>.md
---
```

Update `owners`, `summary`, `domain`, `tags`, `depends_on`, `implements`. Keep every line tx generated (including `doc_id`) and add `plan:`.

### Body Structure — ALL sections MUST have real content

**`# Plan` comes first (as a reference to the plan file). Then all technical sections. No section may be a stub.**

**If a companion PRD exists, every `must` EARS requirement maps to an invariant + verification entry.**

**Required sections (checked by `tx spec lint`, see `tx doc template design`):** Summary, Architecture, Interfaces, Data Model, Invariants, Failure Modes, Verification. The YAML blocks must match the schema exactly as shown below.

```markdown
# Plan

> Full plan: [~/.claude/plans/<name>.md](../~/.claude/plans/<name>.md)
> tx plan doc: [<name>-plan](../plan/<name>-plan.md)

<2-3 sentence summary of what the plan covers. The full plan lives in the file referenced above.>

# Summary

2-3 sentences on design approach and key technical decisions.

# Architecture

## System Context

Where this feature sits in the existing system. Reference `docs/ARCHITECTURE.md`.

## Component Diagram

```
┌──────────────────────────────────────────────────────┐
│                    API Layer                          │
│  ┌──────────────────────────────────────────┐       │
│  │  apps/api [MOD]                          │       │
│  │  ├── routes/<domain>.ts [NEW]            │       │
│  └──────────────────┬───────────────────────┘       │
└─────────────────────┼────────────────────────────────┘
                      ▼
┌──────────────────────────────────────────────────────┐
│                  Domain Layer                         │
│  ┌──────────────────────────────────────────┐       │
│  │  packages/core/src/domains/<domain>/ [NEW]│       │
│  │  ├── domain/     [NEW]                    │       │
│  │  ├── ports/      [NEW]                    │       │
│  │  ├── application/ [NEW]                   │       │
│  │  └── adapters/   [NEW]                    │       │
│  └──────────────────┬───────────────────────┘       │
└─────────────────────┼────────────────────────────────┘
                      ▼
┌──────────────────────────────────────────────────────┐
│              Infrastructure Layer                     │
│  ┌─────────────┐                                    │
│  │ infra/db    │                                    │
│  │ [MOD]       │                                    │
│  └─────────────┘                                    │
└──────────────────────────────────────────────────────┘
```

Mark: `[NEW]`, `[MOD]`, or unmarked.

## Component Inventory

| Component | Package/App | Responsibility | New/Modified |
|-----------|-------------|---------------|--------------|

## Design Decisions

**MINIMUM: ≥ 1 decision with ADR-lite format.**

### Decision 1: <Title>

**Context:** Why needed.
**Options:**

| Option | Pros | Cons |
|--------|------|------|

**Decision:** Option X because <reasoning>.
**Consequences:** What follows.

# Interfaces

One entry per public surface. `type` MUST be one of `http | queue | event | rpc | cron`; `method` and `path` apply to `http`. Internal port contracts and schemas go in the TypeScript sections below, not in this block.

```yaml
interfaces:
  - name: Create<X>
    type: http
    method: POST
    path: /v1/<x>
    semantics: <what the call does, auth/permission, idempotency>
    contract: Create<X>Request -> Create<X>Response (packages/contracts/src/<x>.ts)
  - name: <domain>.<past-tense-verb>
    type: event
    semantics: <when it is emitted via the transactional outbox and who consumes it>
    contract: <Domain><Verb>EventPayloadSchema
```

## API Endpoints

| Method | Path | Request Schema | Response Schema | Auth | Permission |
|--------|------|---------------|----------------|------|-----------|

### Request/Response Schemas

```typescript
import { Schema } from 'effect'
export const Create<X>Request = Schema.Struct({ /* fields */ })
export const Create<X>Response = Schema.Struct({ /* fields */ })
```

### Error Responses

| Status | Error Code | Condition | Response Body |
|--------|-----------|-----------|--------------|
| 400 | `VALIDATION_ERROR` | Invalid request body | `{ error, details }` |
| 401 | `UNAUTHORIZED` | Missing/expired token | `{ error }` |
| 403 | `FORBIDDEN` | Insufficient permissions | `{ error }` |
| 404 | `NOT_FOUND` | Resource doesn't exist | `{ error }` |
| 409 | `CONFLICT` | Duplicate / state conflict | `{ error, details }` |

## Port Contracts

```typescript
export interface <Domain>Repository {
  create(input: Create<X>Input): Effect.Effect<X, <Error>>
  findById(id: string): Effect.Effect<X | null, <Error>>
  findMany(filter: <Filter>): Effect.Effect<readonly X[], <Error>>
  update(id: string, input: Update<X>Input): Effect.Effect<X, <Error>>
  remove(id: string): Effect.Effect<void, <Error>>
}
```

## Event Payloads (if applicable)

```typescript
export interface <Domain><Verb>EventPayload { /* fields */ }
export const <Domain><Verb>EventPayloadSchema = Schema.Struct({ /* fields */ })
```

# Data Model

## New Tables

```sql
CREATE TABLE <table_name> (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_<table>_<column> ON <table_name>(<column>);
```

## Modified Tables

```sql
ALTER TABLE <existing_table> ADD COLUMN <column> <type>;
```

## Effect Schemas

```typescript
export const <Table>Schema = Schema.Struct({ /* columns */ })
```

## Factories

```typescript
export const create<Table>Factory = (overrides?: Partial<Table>): Table => ({ /* defaults */ })
```

## Entity Relationship Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ organizations │────<│    teams      │────<│   <entity>   │
│              │  1:N │              │  1:N │              │
└──────────────┘     └──────────────┘     └──────────────┘
```

# Invariants

**MINIMUM: ≥ 5 invariants. If companion PRD exists, every `must` EARS req MUST map to an invariant.**

Each invariant needs `id` (`INV-[A-Z0-9-]+`, uppercase), `statement`, `severity` (`low | medium | high | critical`), and `verified_by` (a list of ≥ 1 test file path or lint/pgTAP script that enforces it). `traces_to` is optional, for the PRD requirement.

```yaml
invariants:
  - id: INV-<SCOPE>-001
    statement: <what must be true>
    severity: high
    verified_by:
      - apps/api/src/<domain>.integration.test.ts
    traces_to: REQ-<SCOPE>-001  # optional: PRD requirement
```

# Failure Modes

**MINIMUM: ≥ 3 failure modes.**

Each entry needs `condition`, `impact`, and `handling`. Put detection, automatic mitigation, and manual recovery in `handling`.

```yaml
failure_modes:
  - condition: <what causes failure>
    impact: <user/system effect>
    handling: <detection (logs, metrics, alerts); automatic mitigation; manual recovery>
```

# Verification

**MINIMUM: ≥ 5 entries. Every requirement MUST have a verification entry; every invariant is tied to its tests through `verified_by`.**

Each entry needs `requirement_id` (`REQ-[A-Z0-9-]+`: the companion PRD's ids, or design-local `REQ-<SCOPE>-NNN` ids when there is no PRD), `test_type` (`unit | integration | e2e | property | manual`), and `target` (test file path, optionally `#` test name). pgTAP suites are `integration`; lint-script checks are `manual` unless a test runs them.

```yaml
verification:
  - requirement_id: REQ-<SCOPE>-001
    test_type: integration
    target: apps/api/src/<domain>.integration.test.ts#creates resource with valid input
  - requirement_id: REQ-<SCOPE>-002
    test_type: unit
    target: packages/core/src/domains/<domain>/domain/<entity>.test.ts
```

# Sequence Diagrams

**MINIMUM: ≥ 2 (happy path + at least one error path).**

## Happy Path: <Operation>

```
Client              API                   Core                  DB                   Worker
  │                  │                     │                    │                     │
  │ POST /api/<x>    │                     │                    │                     │
  │─────────────────▶│                     │                    │                     │
  │                  │ validate + auth      │                    │                     │
  │                  │ create<X>(input)     │                    │                     │
  │                  │────────────────────▶│                    │                     │
  │                  │                     │ BEGIN TXN           │                     │
  │                  │                     │───────────────────▶│                     │
  │                  │                     │ INSERT + event      │                     │
  │                  │                     │───────────────────▶│                     │
  │                  │                     │ COMMIT             │                     │
  │                  │                     │───────────────────▶│                     │
  │                  │◀────────────────────│                    │                     │
  │ 201 Created      │                     │                    │                     │
  │◀─────────────────│                     │                    │ poll + dispatch      │
  │                  │                     │                    │◀────────────────────│
```

## Error Path: <Failure>

```
Client              API
  │ POST /api/<x>    │
  │─────────────────▶│
  │                  │ <failure point>
  │ <status code>    │
  │◀─────────────────│
```

# Testing Strategy

**Integration tests are the primary verification mechanism and a HARD REQUIREMENT. Unit tests are recommended but secondary.**

## Integration Tests

**HARD REQUIREMENT: ≥ 2 integration test files listed. Design docs MUST NOT be considered complete without integration tests.**

| Test File | What It Covers | Invariants |
|-----------|---------------|------------|

### Integration Test Patterns

```typescript
describe('<Domain> API', () => {
  it('returns 401 for unauthenticated [INV-<SCOPE>-003]', async () => { /* ... */ })
  it('creates resource with valid input', async () => { /* ... */ })
})
```

## Unit Tests (recommended, not hard requirement)

| Test File | What It Covers | Invariants |
|-----------|---------------|------------|

### Unit Test Patterns

```typescript
describe('<Entity>', () => {
  it('creates valid entity [INV-<SCOPE>-001]', () => { /* ... */ })
  // @spec REQ-<SCOPE>-001
  it('rejects invalid input', () => { /* ... */ })
})
```

## Database Contract Tests (pgTAP)

| Test File | What It Covers |
|-----------|---------------|

## Test Annotation Convention

```typescript
it('description [INV-<SCOPE>-001]', () => { ... })  // preferred
// @spec INV-<SCOPE>-001                              // alternative (in test files)
```

`tx spec discover` counts `[INV-*]` and `@spec` annotations as test coverage only inside test files. A `@spec` comment in production source is recorded as a source reference, not coverage — every invariant still needs an annotated test.

# Migration Strategy

## Database Migration

**File:** `packages/infra/db/migrations/NNNN_<description>.sql`

## Rollback Plan

| Step | Action | Verification |
|------|--------|-------------|

# Security Considerations

| Concern | Mitigation | Enforcement |
|---------|-----------|-------------|

# Cross-Cutting Concerns

## Observability
## Data Retention

# Implementation Sequence

```
Phase 1: Domain Foundation
  ├── <specific file paths>

Phase 2: Infrastructure
  ├── <specific file paths>

Phase 3: Application Layer
  ├── <specific file paths>

Phase 4: API Layer
  ├── <specific file paths>

Phase 5: Worker (if domain events)
  ├── <specific file paths>

Phase 6: Quality Gates
  ├── pnpm lint && pnpm type-check && pnpm test && pnpm test:integration
  ├── tx spec discover --doc <name>
  └── tx spec fci --doc <name>
```

# Open Questions

- [ ] Questions requiring design input
```

## Step 4 — Self-Audit

Re-read the plan file and verify:
1. **Comprehensiveness check**: Read the plan file. For EVERY item (implementation steps, constraints, risks, decisions), confirm it has full technical detail in the design doc. The design doc must be detailed enough to implement from alone.
2. If PRD exists: every `must` EARS req has an invariant and a `verification` entry with its `requirement_id`. Every invariant has ≥ 1 `verified_by` path.
3. HARD: ≥2 integration test files (blocking requirement). SOFT: ≥1 unit test file (recommended).
4. Minimums met: ≥5 invariants, ≥3 failure modes, ≥5 verifications, ≥2 sequence diagrams, ≥1 decision.
5. No stubs, no empty tables, no "..." placeholders.
6. All diagrams complete.
7. Implementation sequence lists real file paths.
8. Verify plan file exists at the path in frontmatter and its content is consistent with the doc sections.

## Step 5 — Validate

```bash
tx doc sync <name>   # refresh hash, derived invariants, and index after editing the file
tx spec lint         # must report no schema errors or missing sections for this doc
```

## Step 5.5 — Sync Plan File (MANDATORY)

After filling and validating the doc, **update the plan file** at the `plan:` frontmatter path to reflect everything the design doc surfaced. The plan file must be the living source of truth — not a stale initial draft.

What to add to the plan file:
- Architecture decisions and their rationale
- Component inventory and file paths
- Interface contracts (API endpoints, port signatures, event payloads)
- Data model details (tables, indexes, constraints)
- Implementation sequence with specific file paths
- Invariants, failure modes, and error handling strategies
- Testing strategy and test file locations

Read the current plan file, merge in the new information, and write it back. Preserve the plan's structure but ensure it now covers the full technical design.

Then copy the updated plan into the tx plan doc body (keep its frontmatter) and run:

```bash
tx doc sync <name>-plan
```

## Step 6 — Discover, Link & Report

```bash
tx spec discover --doc <name>
tx doc link <prd> <design>       # if PRD exists
tx doc show <name>
tx spec gaps --doc <name>
```

## After Generation

1. Print output path (`specs/design/<name>.md`).
2. Summarize: component count, invariant count, failure mode count, verification count, test file count.
3. If PRD exists, show EARS→invariant mapping coverage.
4. List open questions.
5. Run `tx spec lint`.
6. If the plan file is modified later, update the `# Plan` summary and derived sections in this doc. If this doc's scope changes, update the plan file and the `<name>-plan` tx doc to stay consistent, then `tx doc sync`.
