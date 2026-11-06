---
paths:
  - "packages/core/src/domains/*/events.ts"
  - "packages/core/src/domains/*/domain/*-events.ts"
  - "packages/contracts/src/literals.ts"
  - "packages/temporal-client/src/types/**"
  - "packages/infra/db/src/repositories/**"
  - "apps/worker/src/workflows*.ts"
  - "apps/worker/src/activities*.ts"
---

# Domain event constraints

Domain events flow through a transactional outbox: the API writes an event row in the same transaction as the state change, and the worker's outbox poller dispatches it to a child workflow. Adding an event touches every row below.

| ID | Rule | Enforced by |
|---|---|---|
| EVT-01 | Events are written through the outbox, never sent to Temporal from `apps/api`. | `script:scripts/lint/enforce-domain-event-contracts.mjs`, `eslint:no-restricted-imports` |
| EVT-02 | Event types are named `<aggregate>.<past_tense_verb>` and match `^[a-z][a-z_]*\.[a-z][a-z_]*$`. | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
| EVT-03 | Every event type used in code is registered in `domainEventTypes` (and its aggregate in `domainEventAggregateTypes`) in `packages/contracts/src/literals.ts`. | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
| EVT-04 | Each event type has `export interface <Pascal>EventPayload` in `packages/core/src/domains/<aggregate>/domain/<aggregate>-events.ts`. The domain's root `events.ts` re-exports it with the discriminant and a version constant, and `packages/core/src/index.ts` exports them. Names derive by dot-split PascalCase (`organization.created` → `OrganizationCreatedEventPayload`). | `script:scripts/lint/enforce-domain-event-contracts.mjs` [partial: the interface only] |
| EVT-05 | Each event type has `export const <Pascal>EventPayloadSchema` in `packages/temporal-client/src/types/`, with the same field names as the interface. | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
| EVT-06 | Event rows are inserted inside `db.transaction()` (or with a `trx` handle) through `insertDomainEventInTransaction`; no inline `.insert(domainEvents).values(…)` outside `repositories/domain-events.ts`. Services never import the domain-events repository. | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
| EVT-07 | The worker dispatcher (`switch (event.eventType)` in `apps/worker/src/dispatch/resolve-dispatch.ts`) has a `case` for every registered type and a `default:`. | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
| EVT-08 | Every dispatch plan in `apps/worker/src/dispatch/resolve-dispatch.ts` has a `workflowId` containing `${event.id}`, and `outbox-dispatcher.ts` starts it with `workflowIdReusePolicy: 'REJECT_DUPLICATE'`. | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
| EVT-09 | Never cast `.payload as <Type>`; decode the payload with its Schema. | `script:scripts/lint/enforce-domain-event-contracts.mjs` |
| EVT-10 | Cover a new event in `packages/testkit/src/domain-events-outbox.integration.test.ts`: written transactionally, correct payload, full lifecycle. | none |
