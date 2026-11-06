'use client'

import type { InvitationAssignableRole, MembershipType } from '@tx-agent-kit/contracts'
import ReactSelect, {
  components as reactSelectComponents,
  type MultiValueRemoveProps,
  type StylesConfig
} from 'react-select'
import type { TeamsListTeams200DataItem } from '@/lib/api/generated/schemas/teamsListTeams200DataItem'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { InviteWorkspaceOption } from './membersLibrary'
import type { InviteMemberForm } from './useInviteMemberForm'

const inviteAccessOptions: ReadonlyArray<{
  readonly value: InvitationAssignableRole
  readonly title: string
  readonly description: string
}> = [
  {
    value: 'member',
    title: 'Member',
    description: 'Can view and execute workflows.'
  },
  {
    value: 'admin',
    title: 'Admin',
    description: 'Full access including billing and member management.'
  }
] as const

const inviteMemberTypeOptions: ReadonlyArray<{
  readonly value: MembershipType
  readonly title: string
  readonly description: string
}> = [
  {
    value: 'team',
    title: 'Internal teammate',
    description: 'Normal teammate access with workspace-scoped invites.'
  },
  {
    value: 'client',
    title: 'Client collaborator',
    description: 'Client-facing access for shared workspace content.'
  }
] as const

const inviteWorkspaceSelectStyles: StylesConfig<InviteWorkspaceOption, true> = {
  control: (base, state) => ({
    ...base,
    minHeight: 46,
    borderColor: state.isFocused ? 'var(--ring)' : 'var(--input)',
    boxShadow: state.isFocused ? '0 0 0 2px color-mix(in oklch, var(--ring) 35%, transparent)' : 'none',
    cursor: 'pointer',
    fontSize: '0.875rem'
  }),
  valueContainer: (base) => ({
    ...base,
    gap: '0.25rem',
    padding: '0.25rem 0.5rem'
  }),
  multiValue: (base, state) => ({
    ...base,
    maxWidth: '100%',
    borderRadius: '9999px',
    backgroundColor: state.data.scope === 'all' ? 'var(--primary)' : 'var(--muted)'
  }),
  multiValueLabel: (base, state) => ({
    ...base,
    color: state.data.scope === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)',
    fontSize: '0.75rem',
    fontWeight: 600,
    paddingInline: '0.625rem'
  }),
  multiValueRemove: (base, state) => ({
    ...base,
    borderRadius: '9999px',
    color: state.data.scope === 'all' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
    cursor: 'pointer',
    display: state.data.scope === 'all' ? 'none' : base.display,
    ':hover': {
      backgroundColor: state.data.scope === 'all' ? 'color-mix(in oklch, var(--primary-foreground) 18%, transparent)' : 'var(--destructive)',
      color: state.data.scope === 'all' ? 'var(--primary-foreground)' : 'white'
    }
  }),
  menu: (base) => ({
    ...base,
    border: '1px solid var(--border)',
    boxShadow: '0 18px 40px color-mix(in oklch, var(--foreground) 16%, transparent)',
    overflow: 'hidden',
    zIndex: 1700
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 1700
  }),
  option: (base, state) => {
    let backgroundColor = 'var(--background)'
    if (state.isSelected) {
      backgroundColor = 'var(--primary)'
    } else if (state.isFocused) {
      backgroundColor = 'var(--accent)'
    }

    return {
      ...base,
      backgroundColor,
      color: state.isSelected ? 'var(--primary-foreground)' : 'var(--foreground)',
      cursor: 'pointer',
      padding: '0.7rem 0.85rem'
    }
  }
}

const InviteWorkspaceMultiValueRemove = (
  props: MultiValueRemoveProps<InviteWorkspaceOption, true>
) => {
  if (props.data.scope === 'all') {
    return null
  }

  return (
    <reactSelectComponents.MultiValueRemove
      {...props}
      innerProps={{
        ...props.innerProps,
        'aria-label': `Remove ${props.data.label}`,
        title: `Remove ${props.data.label}`
      }}
    />
  )
}

export function InviteMemberDialog({
  form,
  teams
}: {
  form: InviteMemberForm
  teams: TeamsListTeams200DataItem[]
}) {
  const {
    inviteDialogOpen,
    setInviteDialogOpen,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    inviteMemberType,
    setInviteMemberType,
    inviteError,
    setInviteError,
    inviteSubmitting,
    inviteWorkspaceOptions,
    selectedInviteWorkspaceOptions,
    selectedInviteTeamOptions,
    inviteWorkspaceSummary,
    closeInviteDialog,
    handleInviteWorkspaceChange,
    submitInvite
  } = form

  return (
    <Dialog
      open={inviteDialogOpen}
      onOpenChange={(open: boolean) => {
        if (!open) {
          closeInviteDialog()
        } else {
          setInviteDialogOpen(true)
        }
      }}
    >
      <DialogContent
        aria-label="Invite member"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[960px]"
      >
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>
            Send an invitation to a new teammate with the right level of access from the start.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void submitInvite()
          }}
        >
        <div className="grid min-w-0 gap-5 py-2 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-semibold">Who and where</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Invite across every workspace, or pick one or more specific workspaces.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="member@example.com"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value)
                  if (inviteError) {
                    setInviteError(null)
                  }
                }}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-workspace-access">Workspace access</Label>
              <ReactSelect<InviteWorkspaceOption, true>
                inputId="invite-workspace-access"
                instanceId="invite-workspace-access"
                aria-label="Workspace access"
                classNamePrefix="invite-workspace-select"
                closeMenuOnSelect={false}
                components={{ MultiValueRemove: InviteWorkspaceMultiValueRemove }}
                getOptionLabel={(option) => option.label}
                getOptionValue={(option) => option.value}
                hideSelectedOptions={false}
                isClearable={selectedInviteTeamOptions.length > 0}
                isMulti
                options={inviteWorkspaceOptions}
                value={selectedInviteWorkspaceOptions}
                isSearchable={teams.length > 6}
                maxMenuHeight={190}
                menuPlacement="auto"
                menuPosition="fixed"
                menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                menuShouldBlockScroll
                menuShouldScrollIntoView={false}
                styles={inviteWorkspaceSelectStyles}
                formatOptionLabel={(option, meta) => (
                  meta.context === 'value' ? (
                    <span className="max-w-full truncate">{option.label}</span>
                  ) : (
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{option.label}</span>
                      <span className="truncate text-xs text-current/70">{option.description}</span>
                    </div>
                  )
                )}
                onChange={handleInviteWorkspaceChange}
              />
              <p className="text-sm text-muted-foreground">
                {inviteWorkspaceSummary}. “All workspaces” is exclusive; selecting a workspace switches to scoped invites.
              </p>
              {teams.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No workspaces yet. This invite will stay organization-wide until you create one.
                </p>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-semibold">Permissions</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose what they can do and how they should be treated after accepting.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Access level</Label>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2" role="group" aria-label="Access level">
                {inviteAccessOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={inviteRole === option.value ? 'default' : 'outline'}
                    aria-pressed={inviteRole === option.value}
                    className="h-auto min-h-[4.75rem] min-w-0 cursor-pointer items-start justify-start overflow-hidden whitespace-normal rounded-xl px-3 py-2.5 text-left"
                    onClick={() => setInviteRole(option.value)}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <span className="font-medium leading-5">{option.title}</span>
                      <span className={cn(
                        'whitespace-normal break-words text-xs leading-4',
                        inviteRole === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'
                      )}
                      >
                        {option.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Member type</Label>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2" role="group" aria-label="Member type">
                {inviteMemberTypeOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={inviteMemberType === option.value ? 'default' : 'outline'}
                    aria-pressed={inviteMemberType === option.value}
                    className="h-auto min-h-[4.75rem] min-w-0 cursor-pointer items-start justify-start overflow-hidden whitespace-normal rounded-xl px-3 py-2.5 text-left"
                    onClick={() => setInviteMemberType(option.value)}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <span className="font-medium leading-5">{option.title}</span>
                      <span className={cn(
                        'whitespace-normal break-words text-xs leading-4',
                        inviteMemberType === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'
                      )}
                      >
                        {option.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Client collaborators keep a client membership type when they accept the invite.
              </p>
            </div>
          </div>
          {inviteError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive md:col-span-2">
              {inviteError}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              closeInviteDialog()
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!inviteEmail.trim() || inviteSubmitting}
          >
            {inviteSubmitting ? 'Sending...' : 'Send Invitation'}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
