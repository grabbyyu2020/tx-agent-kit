# Workspaces

An organization holds one or more workspaces, each with its own name and brand settings. Users create workspaces from the Workspaces page, open one to reach its dashboard, switch between them in the sidebar, and delete workspaces they no longer need.

## Sub-features

- `workspace-create` creates a workspace from the `Create workspace` dialog and opens it.
- `workspace-open` opens a workspace from the Workspaces list or the sidebar `Workspace` combobox.
- `workspace-delete` deletes a workspace from the list.

## How to get to it (user POV)

- Choose `Workspaces` in the sidebar, or open `/org/<orgId>/workspaces`.
- Use the sidebar `Workspace` combobox on any workspace page.

## Driving it with agent-browser

Preconditions:

- The session is signed in through a developer-utilities preset ([dev-session.md](./dev-session.md)). `ORG` is the first UUID in the URL after the preset.
- `NAME="Verify WS $(date +%s)"`.

- **Open the list.** Run `$B open http://localhost:3000/org/$ORG/workspaces` and `$B wait --text "Create workspace"`. The heading is `Workspaces`, and the preset's workspace appears with a `Delete workspace <name>` button.
- **Open the dialog.** Run `$B find role button click --name "Create workspace"`. A dialog with the heading `Create workspace` shows the textboxes `Workspace name`, `Website`, and brand colors, and its submit button is disabled.
- **Create.** Run `$B find label "Workspace name" fill "$NAME"` and then `$B click '[role=dialog] button[type=submit]'`. The URL becomes `/org/$ORG/<newTeamId>`, the heading is `$NAME`, the sidebar combobox shows `$NAME`, and a toast reads `Workspace "$NAME" created`.
- **Confirm.** Run psql with `select name from teams where organization_id = '<ORG>' order by created_at`. The query lists the preset workspace and `$NAME`.
- **Proof.** Take a screenshot of the dialog before submit and of the new dashboard after it. Save the psql output.

## Gotchas

- The page shows a `Create workspace` button and the dialog has a submit button with the same name. While the dialog is open, `find role button click --name "Create workspace"` hits the overlay. Use `[role=dialog] button[type=submit]`.
- Only `Workspace name` is required in this dialog. The onboarding wizard requires every brand field. See [sign-up-onboarding.md](./sign-up-onboarding.md).
- `workspace-delete` has not been driven yet. Create a second workspace first, so the preset workspace is still there for later recipes.
