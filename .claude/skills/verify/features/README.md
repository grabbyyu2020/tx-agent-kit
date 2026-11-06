# tx-agent-kit verification map

This directory is the maintained source for verifying the user-facing behavior of the tx-agent-kit web app. Read this index before you drive the app. Then use the matching feature file as the recipe.

## Baseline preconditions

- The stack was launched per [../SKILL.md](../SKILL.md), and `.claude/skills/verify/scripts/doctor.sh` prints `doctor: stack ready`.
- The web app is at `http://localhost:3000` and the API is at `http://localhost:4000`.
- `AGENT_BROWSER_NAMESPACE=verify` is exported, and `B="agent-browser --session <name>"` names one session for this run.
- `RUN` points at this run's evidence directory under `.artifacts/verify/`.

## Driving conventions

- Start each recipe from a fresh developer-utilities account ([dev-session.md](./dev-session.md)) unless its preconditions say otherwise.
- Use accessible names first, then element ids. Use `[role=dialog] button[type=submit]` for dialog submit buttons.
- After each `open`, use `wait --text` for a visible string before the first action.
- Use names that include the run timestamp for the data you create, so that a psql query finds this run's rows only.

## Proof and skip reporting

- Capture the action and the result: a `snapshot -i` excerpt or a screenshot from before the decisive click, and the same from after it.
- Pair each UI end state with a second view: the psql row, or the API or worker log line.
- Record the feature file and the entry point with every artifact.
- If a precondition is not met (no credentials, no network), report the attempted step and the missing precondition. Do not report the feature as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. It then has exactly four H2 sections, in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with agent-browser`, and `Gotchas`.

## Features

- [Developer session presets](./dev-session.md) covers the developer utilities that create a fresh signed-in user, organization, and workspace.
- [Sign up and onboarding](./sign-up-onboarding.md) covers email sign-up, the organization onboarding wizard, and sign-in.
- [Workspaces](./workspaces.md) covers creating, opening, and deleting workspaces inside an organization.
- [Members and invitations](./members-invitations.md) covers inviting a member to an organization and revoking the invitation.
- [Shadowing practice](./shadowing.md) covers importing a YouTube video for sentence-by-sentence shadowing practice.
