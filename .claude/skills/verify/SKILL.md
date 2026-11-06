---
name: verify
description: Launch the tx-agent-kit stack (Postgres, Redis, Temporal, Effect API, Temporal worker, Next.js web SPA) and drive the web app in a real browser to prove a feature works, with screenshots, page snapshots, and database rows as evidence. Use before reporting a web, API, or worker change as done, and to reproduce a bug on the real stack.
---

# Verify tx-agent-kit

The primary surface is the web SPA at `http://localhost:3000`. It calls the API at `http://localhost:4000`. Background work runs in the Temporal worker. The mobile app (`apps/mobile`) and docs site (`apps/docs`) are out of scope here.

Run the commands from the repository root. The feature recipes are in [features/README.md](features/README.md). Read the index before you drive anything.

## Isolation

The stack runs as one instance per machine. Ports 3000, 4000, 5432, 6379, and 7233 are fixed, and every worktree shares the same database and Temporal task queue (OPS-05). Never start a second stack. If the doctor fails because another checkout holds a port, stop and report it. Do not kill that process.

## Launch

Before you launch, run `amp orb service list` in an orb and write down which services are already active. Cleanup stops only the services that this run started.

**In an Amp orb (no Docker).** Orbs lack `CAP_SYS_ADMIN`, so Docker cannot run containers. `.agents/setup` installs Postgres 16, Redis, and the Temporal CLI natively, and it creates and migrates the database. `.amp/services.yaml` declares the six services.

```bash
amp orb services ensure                 # starts postgres redis temporal api worker web
pnpm db:migrate                         # idempotent; applies migrations added since setup
scripts/seed-dev-account.sh             # idempotent; dev@tx-agent-kit.local / dev-password-12345
.claude/skills/verify/scripts/doctor.sh
```

If `~/.local/share/tx-agent-kit/postgres` does not exist, run `.agents/setup` first. It is idempotent. If `ensure` reports `api ... NOT RESPONDING`, read `amp orb service logs api`. A `tsx: not found` line means that the login-shell PATH broke. Run `.agents/resume`, then `amp orb service restart api`.

**On a machine with Docker.** Run `pnpm dev`. It starts the Docker infrastructure and Temporal, seeds the dev account, and runs api, web, and worker under turbo. Then run the doctor in another terminal. This path was not exercised when this skill was generated.

**Ready** means that the doctor prints `doctor: stack ready` and exits 0. A port that accepts connections is not enough. Next.js compiles each route on its first request, so the first `open` of a page can take 20 to 60 seconds.

## Doctor

```bash
.claude/skills/verify/scripts/doctor.sh
```

The doctor is read-only. It checks the orb services (in an orb only), Postgres, the latest applied migration against `packages/infra/db/drizzle/migrations`, Redis, Temporal, the worker's pollers on the task queue, API `/health`, and the `/sign-in` page. Run it first, and again whenever something looks wrong. Do not drive the app while any line says `FAIL`.

## Drive

Use `agent-browser`. It is preinstalled in orbs. Run `agent-browser skills get core --full` once for its command reference. Use a namespace and one session for each run.

```bash
export AGENT_BROWSER_NAMESPACE=verify
RUN=".artifacts/verify/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$RUN"
B="agent-browser --session v1"
$B open http://localhost:3000/sign-in
$B set viewport 1280 800 2
$B wait --text "Welcome back"
```

- Get a signed-in session from the developer utilities. See [features/dev-session.md](features/dev-session.md). Each preset creates a new user, organization, and workspace, so runs do not collide.
- After each `open`, use `wait --text` for a visible string before you act. The SPA renders its controls only after hydration and data loading. A `find role button` call made too early sees only the devtools buttons.
- Prefer handles in this order: accessible names (`find role button click --name "..."`, `find label "..." fill ...`), element ids (`#auth-email`), and `[role=dialog] button[type=submit]` for dialog submit buttons. A dialog's overlay covers the page button that has the same name.
- Read the rows behind a page with psql. `.env` holds `DATABASE_URL`.

```bash
psql "$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')" -Atc "select email from users order by created_at desc limit 1"
```

- Service logs: in an orb, run `amp orb service logs api` (or `worker` or `web`). With `pnpm dev`, read the turbo output.

## Evidence

Write every artifact under `$RUN` (`.artifacts/verify/<timestamp>/`, gitignored). Pass absolute paths to agent-browser, because a path that starts with `.` is read as a CSS selector.

- Capture the action and the result. Take a `snapshot -i` and a screenshot before the decisive click and after it: `$B screenshot "$PWD/$RUN/<feature>-after.png"`.
- Prove each side effect at a second place. Pair the page state with the psql row it wrote, or with the API or worker log line it caused.
- Drive the real user path through the UI. Do not call internal endpoints or test-only setters to reach the end state. The developer-utilities presets are an exception. They are the supported way to get a fresh signed-in account.
- Integrations without credentials in this environment (Resend email, OpenRouter, the shadowing LLM, Stripe, R2) log a skip or fail. Report that as an unmet precondition. Do not count it as verified.

## Cleanup

```bash
agent-browser --session v1 close                 # with AGENT_BROWSER_NAMESPACE=verify still exported
for s in web worker api temporal redis postgres; do amp orb service stop "$s"; done   # only those this run started
```

- Close only the browser sessions that you opened. Stop only the services that this run started. Never kill processes by name.
- Leave the rows that the run created. They belong to throwaway preset accounts, and `usage_records` and `credit_ledger` must never be deleted (DB-12).
- Never delete `$RUN`. After cleanup, run `ls "$RUN"` to confirm that the evidence still exists.

## Helpers

- `.claude/skills/verify/scripts/doctor.sh` prints one `ok` or `FAIL` line for each check, and exits non-zero if any check fails.

Keep this skill and its feature map current with `/maintain-verification-skill`.
