---
paths:
  - "apps/worker/**"
  - "packages/temporal-client/**"
---

# Worker and Temporal constraints (`apps/worker`, `packages/temporal-client`)

Event dispatch rules for the worker are in `domain-events.md`.

| ID | Rule | Enforced by |
|---|---|---|
| WRK-01 | Workflow code is deterministic. No `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `Date`, or `Math.random` in workflows; use Temporal's `sleep`, workflow time, and activities for side effects. | none [ESLint selectors are shadowed for `apps/worker/src/**`] |
| WRK-02 | Workflows reach the outside world only through activities registered in `apps/worker/src/activities.ts` and called via `proxyActivities` with explicit timeouts and retry policy. | none |
| WRK-03 | Activities are idempotent: a retry or a replayed event converges to the same end state (`alreadyProcessed: false → true`). | none |
| WRK-04 | Read env only through `apps/worker/src/config/env.ts`. | `script:scripts/lint/invariants/source-hygiene.mjs` |
| WRK-05 | Loggers are created with `createLogger('tx-agent-kit-…')`. | `eslint:no-restricted-syntax` [createLogger prefix selector] |
| WRK-06 | Schedules are registered idempotently in `apps/worker/src/schedules.ts`. | none |
