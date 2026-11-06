# Developer session presets

The developer utilities panel, which exists only in development builds, creates a fresh user, organization, and workspace in one click. It signs the browser in as that user and opens the new workspace dashboard. It is the fastest way to get a signed-in starting state for every other recipe.

## Sub-features

- `preset-free` creates a fresh free-plan account and opens its workspace.
- `preset-pro-credit` creates a fresh account with Pro activated and the local welcome credit. Use it for billing-gated features.
- `preset-names` sets the email prefix and the user, organization, and workspace name bases before a preset runs.

## How to get to it (user POV)

- On any page, choose the floating `Open developer utilities` button, then choose a preset card's button.

## Driving it with agent-browser

Preconditions:

- The doctor passes.
- The browser session is on any page of `http://localhost:3000`.

- **Open the panel.** Run `$B open http://localhost:3000/sign-in`, `$B wait --text "Welcome back"`, and `$B click 'button[aria-label="Open developer utilities"]'`. The snapshot shows the textboxes `Email prefix` (`dev-utils`), `User name base`, `Org name base`, and `Workspace name base`, and the buttons `Fresh free org` and `Fresh Pro + $20 local credit`.
- **Run the free preset.** Run `$B click 'button[aria-label="Fresh free org"]'` and then `$B wait --url '**/org/**'`. The URL becomes `/org/<orgId>/<teamId>`, a toast reads `Fresh dev workspace ready`, and the page heading is `Sandbox <stamp>`. `<stamp>` looks like `20261106102857-a3e156`.
- **Confirm the account.** Run psql with `select u.email, o.name, t.name from users u join org_members m on m.user_id = u.id join organizations o on o.id = m.organization_id join teams t on t.organization_id = o.id order by u.created_at desc limit 1`. The row is `dev-utils+<stamp>@example.com | Dev Org <stamp> | Sandbox <stamp>`.
- **Proof.** Run `$B screenshot "$PWD/$RUN/dev-session-after.png"` and save the psql output to `$RUN/dev-session-db.txt`.

## Gotchas

- Every preset user has the password `tx-agent-kit-dev-12345`, which the panel shows. Use it to sign the same user in from a second session.
- Running a preset replaces the browser's current session. Use a separate `--session` for each user that a recipe needs at the same time.
- The two Stripe checkout presets appear only when the web env sets `STRIPE_PUBLISHABLE_KEY`. Without it, the panel shows two presets.
