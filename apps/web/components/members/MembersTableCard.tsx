'use client'

import type { AuthPrincipal, OrgMemberRole } from '@tx-agent-kit/contracts'
import ReactSelect, {
  type MultiValue,
  type StylesConfig
} from 'react-select'
import type { TeamsListTeams200DataItem } from '@/lib/api/generated/schemas/teamsListTeams200DataItem'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { roleBadgeVariant, type Member, type TeamMembershipOption } from './membersLibrary'
import { useMembersTable } from './useMembersTable'

const memberTeamSelectStyles: StylesConfig<TeamMembershipOption, true> = {
  control: (base, state) => ({
    ...base,
    minHeight: 36,
    borderColor: state.isFocused ? 'var(--ring)' : 'var(--input)',
    boxShadow: state.isFocused ? '0 0 0 2px color-mix(in oklch, var(--ring) 30%, transparent)' : 'none',
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
    fontSize: '0.8125rem'
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0.125rem 0.5rem',
    gap: '0.25rem'
  }),
  multiValue: (base) => ({
    ...base,
    borderRadius: '9999px',
    backgroundColor: 'var(--muted)'
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: 'var(--foreground)',
    fontSize: '0.75rem',
    paddingInline: '0.5rem'
  }),
  multiValueRemove: (base) => ({
    ...base,
    borderRadius: '9999px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: 'var(--destructive)',
      color: 'white'
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
      cursor: 'pointer',
      fontSize: '0.8125rem',
      backgroundColor,
      color: state.isSelected ? 'var(--primary-foreground)' : 'var(--foreground)'
    }
  }
}

const TrashIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

export function MembersTableCard({
  orgId,
  members,
  teams,
  principal,
  currentUserId,
  isAdmin,
  setGuardMessage,
  invalidateMembers,
  resetInviteForm,
  setInviteDialogOpen,
  setTransferDialogOpen
}: {
  orgId: string
  members: Member[]
  teams: TeamsListTeams200DataItem[]
  principal: AuthPrincipal | null
  currentUserId: string | undefined
  isAdmin: boolean
  setGuardMessage: (message: string | null) => void
  invalidateMembers: () => Promise<void>
  resetInviteForm: () => void
  setInviteDialogOpen: (open: boolean) => void
  setTransferDialogOpen: (open: boolean) => void
}) {
  const {
    removeConfirm,
    setRemoveConfirm,
    selectedMemberIds,
    setSelectedMemberIds,
    bulkRemoveConfirm,
    setBulkRemoveConfirm,
    bulkDisabling,
    bulkRemoving,
    teamMembershipUpdatingUserId,
    memberTeamOptions,
    isSelf,
    bulkSelectableMembers,
    teamMembershipsByUserId,
    teamMembershipsLoading,
    enableMutation,
    disableMutation,
    removeMutation,
    handleRoleChange,
    handleBulkDisable,
    handleBulkRemove,
    handleMemberTeamsChange
  } = useMembersTable({
    orgId,
    members,
    teams,
    principal,
    currentUserId,
    isAdmin,
    setGuardMessage,
    invalidateMembers
  })

  return (
    <>
      {members.length > 0 && (
        <>
        <Card className="overflow-hidden border-border/80 shadow-sm">
        <div className="flex items-center justify-between border-b px-8 py-5">
          <div className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</div>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                resetInviteForm()
                setInviteDialogOpen(true)
              }}
            >
              Invite Member
            </Button>
          )}
        </div>
        {isAdmin && selectedMemberIds.size > 0 && (
          <div className="flex items-center gap-2 border-b bg-muted/50 px-8 py-3">
            <span className="text-sm font-medium">{selectedMemberIds.size} selected</span>
            {bulkRemoveConfirm ? (
              <>
                <span className="text-sm text-destructive font-medium">Remove {selectedMemberIds.size} member{selectedMemberIds.size !== 1 ? 's' : ''}?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={bulkRemoving}
                  onClick={() => { void handleBulkRemove() }}
                >
                  {bulkRemoving ? 'Removing...' : 'Confirm Remove'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkRemoving}
                  onClick={() => setBulkRemoveConfirm(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkDisabling}
                  onClick={() => { void handleBulkDisable() }}
                >
                  {bulkDisabling ? 'Disabling...' : 'Disable Selected'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setBulkRemoveConfirm(true)}
                >
                  Remove Selected
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setSelectedMemberIds(new Set()); setBulkRemoveConfirm(false) }}>
              Clear
            </Button>
          </div>
        )}
        <Table className="[&_td]:px-8 [&_td]:py-5 [&_th]:px-8 [&_th]:py-4">
          <TableHeader className="bg-muted/50">
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    aria-label="Select all members"
                    checked={selectedMemberIds.size === bulkSelectableMembers.length && bulkSelectableMembers.length > 0}
                    disabled={bulkSelectableMembers.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedMemberIds(new Set(bulkSelectableMembers.map((member) => member.id)))
                      } else {
                        setSelectedMemberIds(new Set())
                      }
                    }}
                  />
                </TableHead>
              )}
              <TableHead>Member</TableHead>
              <TableHead>Workspaces</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="w-[220px] text-center">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const memberTeamMemberships = teamMembershipsByUserId.get(member.userId) ?? []
              const memberTeamIds = new Set(memberTeamMemberships.map((membership) => membership.teamId))
              const selectedTeamOptions = memberTeamOptions.filter((option) => memberTeamIds.has(option.value))
              const visibleTeamMemberships = memberTeamMemberships.slice(0, 3)
              const hiddenTeamCount = Math.max(memberTeamMemberships.length - visibleTeamMemberships.length, 0)
              const memberDisplayName = member.userName ?? member.userEmail ?? 'member'
              const canEditTeams = isAdmin

              return (
                <TableRow
                  key={member.id}
                  data-testid="member-row"
                  className={member.disabledAt ? 'opacity-60' : ''}
                >
                  {isAdmin && (
                    <TableCell className="w-10">
                      <input
                        type="checkbox"
                        className="rounded border-border disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Select ${member.userName ?? member.userEmail ?? 'member'}`}
                        disabled={isSelf(member)}
                        checked={selectedMemberIds.has(member.id)}
                        onChange={(e) => {
                          const next = new Set(selectedMemberIds)
                          if (e.target.checked) {next.add(member.id)}
                          else {next.delete(member.id)}
                          setSelectedMemberIds(next)
                        }}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar size="sm">
                        <AvatarFallback>
                          {(member.userName ?? member.userEmail ?? '?').charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">{member.userName ?? member.userEmail ?? 'Unknown user'}</span>
                        {member.userName && member.userEmail && (
                          <span className="text-xs text-muted-foreground">{member.userEmail}</span>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="min-w-[240px] max-w-[320px] whitespace-normal">
                    {canEditTeams ? (
                      <ReactSelect<TeamMembershipOption, true>
                        aria-label={`Teams for ${memberDisplayName}`}
                        classNamePrefix="member-team-select"
                        closeMenuOnSelect={false}
                        isClearable
                        isDisabled={
                          teamMembershipsLoading
                          || teamMembershipUpdatingUserId === member.userId
                          || removeMutation.isPending
                        }
                        isMulti
                        menuPlacement="auto"
                        menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                        menuShouldBlockScroll
                        menuShouldScrollIntoView={false}
                        noOptionsMessage={() => 'No workspaces'}
                        onChange={(nextOptions: MultiValue<TeamMembershipOption>) => {
                          void handleMemberTeamsChange(member, nextOptions)
                        }}
                        options={memberTeamOptions}
                        placeholder={teamMembershipsLoading ? 'Loading...' : 'Select workspaces...'}
                        styles={memberTeamSelectStyles}
                        value={selectedTeamOptions}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {teamMembershipsLoading ? (
                          <span className="text-xs text-muted-foreground">Loading...</span>
                        ) : null}
                        {!teamMembershipsLoading && visibleTeamMemberships.length > 0 ? (
                          <>
                            {visibleTeamMemberships.map((membership) => (
                              <Badge key={membership.teamId} variant="outline" className="max-w-[10rem] truncate">
                                {membership.name}
                              </Badge>
                            ))}
                            {hiddenTeamCount > 0 ? (
                              <Badge variant="secondary">+{hiddenTeamCount}</Badge>
                            ) : null}
                          </>
                        ) : null}
                        {!teamMembershipsLoading && visibleTeamMemberships.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No workspace access</span>
                        ) : null}
                      </div>
                    )}
                    {canEditTeams && memberTeamMemberships.length > 0 && !teamMembershipsLoading ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {isSelf(member)
                          ? 'You can remove individual workspaces; your last workspace is protected here.'
                          : 'Removing the last workspace prompts organization removal.'}
                      </p>
                    ) : null}
                  </TableCell>

                <TableCell>
                  {isAdmin && !isSelf(member) ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => {
                        if (value) { handleRoleChange(member, value as OrgMemberRole) }
                      }}
                    >
                      <SelectTrigger size="sm" data-testid="role-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="member">member</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
                  )}
                </TableCell>

                <TableCell>
                  {member.disabledAt ? (
                    <Badge variant="default" className="bg-gray-500 text-white">disabled</Badge>
                  ) : (
                    <Badge variant="default" className="bg-green-600 text-white">active</Badge>
                  )}
                </TableCell>

                {isAdmin && (
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      {!isSelf(member) && (
                        <>
                          {member.disabledAt ? (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="enable-member-button"
                              aria-label="Enable member"
                              disabled={enableMutation.isPending}
                              onClick={() => enableMutation.mutate({ organizationId: orgId, memberId: member.id })}
                            >
                              {enableMutation.isPending ? 'Enabling...' : 'Enable'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="disable-member-button"
                              aria-label="Disable member"
                              disabled={disableMutation.isPending}
                              onClick={() => disableMutation.mutate({ organizationId: orgId, memberId: member.id })}
                            >
                              {disableMutation.isPending ? 'Disabling...' : 'Disable'}
                            </Button>
                          )}
                          {removeConfirm === member.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">Are you sure?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={removeMutation.isPending}
                                onClick={() => removeMutation.mutate({ organizationId: orgId, memberId: member.id })}
                              >
                                {removeMutation.isPending ? 'Removing...' : 'Confirm'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={removeMutation.isPending}
                                onClick={() => setRemoveConfirm(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              data-testid="remove-member-button"
                              aria-label={`Remove ${member.userName ?? member.userEmail ?? 'member'}`}
                              title="Remove member"
                              onClick={() => setRemoveConfirm(member.id)}
                            >
                              <TrashIcon />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {isAdmin && (
          <div className="flex items-center border-t px-8 py-5">
            <Button variant="outline" size="sm" onClick={() => setTransferDialogOpen(true)}>
              Transfer Ownership
            </Button>
          </div>
        )}
        </Card>
        </>
      )}
    </>
  )
}
