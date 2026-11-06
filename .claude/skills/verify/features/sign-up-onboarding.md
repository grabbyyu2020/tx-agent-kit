# Sign up and onboarding

A visitor creates an account with name, email, and password. The organization onboarding wizard then asks for the organization, the first workspace and its brand settings, a goal and team size, and an optional spend cap. It ends on the new workspace dashboard. A returning user signs in with email and password.

## Sub-features

- `sign-up` creates an account from `/sign-up` and opens `/org/onboarding`.
- `onboarding` creates the organization and first workspace through the wizard steps.
- `sign-in` signs an existing user in from `/sign-in`.
- `sign-in-guard` sends a signed-out visitor from a protected route to `/sign-in`.

## How to get to it (user POV)

- Open `/sign-up`, or choose `Create one` on `/sign-in`.
- Open `/sign-in` directly, or open any `/org/...` route while signed out.

## Driving it with agent-browser

Preconditions:

- The doctor passes.
- Use a new session (`B="agent-browser --session signup"`) so that no earlier sign-in is present.
- `EMAIL="verify-signup-$(date +%s)@example.com"`.

- **Sign up.** Run `$B open http://localhost:3000/sign-up` and `$B wait --text "Create your account"`. Then run `$B fill '#auth-name' 'Verify Signup'`, `$B fill '#auth-email' "$EMAIL"`, `$B fill '#auth-password' 'verify-password-12345'`, and `$B click 'button[type=submit]'`. The URL becomes `/org/onboarding`, the heading is `Organization onboarding`, and a toast reads `Account created successfully`.
- **Organization step.** Run `$B find label "Organization name" fill "Verify Org $EMAIL"` and `$B find role button click --name Continue`. The workspace step shows the textboxes `Workspace name` and `Workspace website`.
- **Workspace step.** Fill `Workspace name` and `Workspace website` (`https://example.com`). Fill the `Industry` combobox, then press Enter. Fill `Target audience` and `Brand guidelines`. Then run `$B click 'button[type=submit]'`. Every brand field is required. When one is empty, the page shows a red line such as `Industry is required.` and stays on this step.
- **Goal step.** The comboboxes `Primary goal` and `Team size` have defaults. Run `$B click 'button[type=submit]'`.
- **Spend cap step.** The heading `Set a monthly spend cap (optional)` appears. Run `$B find role button click --name "Skip for now"`. The URL becomes `/org/<orgId>/<teamId>`, and the heading is the workspace name.
- **Confirm.** Run psql with `select u.email, o.name, t.name from users u join org_members m on m.user_id = u.id join organizations o on o.id = m.organization_id join teams t on t.organization_id = o.id where u.email = '<EMAIL>'`. The query returns one row with the organization and workspace names that you entered.
- **Sign in.** In a new session, open `/sign-in`, `wait --text "Welcome back"`, fill `#auth-email` and `#auth-password`, and choose `Sign in`. The URL becomes the user's `/org/<orgId>/<teamId>` dashboard.
- **Proof.** Take a screenshot after each step into `$RUN/sign-up-<step>.png`, and save the psql output.

## Gotchas

- The wizard keeps one URL (`/org/onboarding`) for every step. Wait on step headings and field labels, not on the URL.
- Brand validation runs on the client. A submit that seems to do nothing usually shows a red validation line. Read it with `$B eval 'Array.from(document.querySelectorAll("p.text-destructive")).map(e => e.textContent).join("|")'`.
- `sign-in-guard` has not been driven with agent-browser yet. `apps/web/e2e/protected-redirect.e2e.test.ts` covers it in Playwright.
- `scripts/seed-dev-account.sh` creates `dev@tx-agent-kit.local` with the password `dev-password-12345`. Use that account for the sign-in recipe when you do not need a fresh user.
