# Members and invitations

Organization admins see every member with their workspaces, role, and status. They invite people by email with a role and workspace access, see pending invitations, and revoke an invitation before it is accepted.

## Sub-features

- `members-list` shows members with workspaces, role, and status.
- `invite-send` sends an invitation from the `Invite Member` dialog and lists it under `Pending Invitations`.
- `invite-revoke` revokes a pending invitation.

## How to get to it (user POV)

- Open `Settings` in the sidebar and choose `Members`, or open `/org/<orgId>/members`.

## Driving it with agent-browser

Preconditions:

- The session is signed in through a developer-utilities preset, so the user is an organization admin. `ORG` is the organization UUID.
- `INVITEE="verify-invitee-$(date +%s)@example.com"`.

- **Open the page.** Run `$B open http://localhost:3000/org/$ORG/members` and `$B wait --text "Invite Member"`. The heading is `Organization Members`, and the table lists the preset user with role `admin` and status `active`.
- **Open the dialog.** Run `$B find role button click --name "Invite Member"`. The dialog shows `#invite-email`, a `Workspace access` field, the role cards `Member`, `Admin`, `Internal teammate`, and `Client collaborator`, and a `Send Invitation` submit button.
- **Send.** Run `$B fill '#invite-email' "$INVITEE"` and `$B click '[role=dialog] button[type=submit]'`. A toast reads `Invitation sent successfully`. The `Pending Invitations` section lists `$INVITEE` with status `pending` and a `Revoke invitation` button.
- **Confirm.** Run psql with `select email, status, role from invitations where email = '<INVITEE>'`. The row is `<INVITEE> | pending | member`.
- **Revoke.** Run `$B find role button click --name "Revoke invitation"`. The row shows `Revoke?` with `Confirm` and `Cancel`. Run `$B find role button click --name "Confirm"`. The `Pending Invitations` section disappears when no other invitation is pending, and the psql status becomes `revoked`.
- **Proof.** Take a screenshot of the filled dialog and of the pending list. Save the psql output from before and after the revoke.

## Gotchas

- Invitation email is not sent without Resend credentials. The API logs `Invitation email skipped because Resend is not configured.` (`amp orb service logs api`). The invitation row and the UI still prove `invite-send`. Report email delivery as unverified.
- With more than one pending invitation, `find role button click --name "Revoke invitation"` picks the first match. Find the right row's ref in `snapshot -i` and click that ref.
