'use client'

import type { InvitationAssignableRole, MembershipType } from '@tx-agent-kit/contracts'
import { useMemo, useState } from 'react'
import type { ActionMeta, MultiValue } from 'react-select'
import { organizationsCreateInvitation } from '@/lib/api/generated/organizations/organizations'
import type { TeamsListTeams200DataItem } from '@/lib/api/generated/schemas/teamsListTeams200DataItem'
import { notify } from '@/lib/notify'
import { ALL_WORKSPACES_VALUE, type InviteWorkspaceOption } from './membersLibrary'

export const useInviteMemberForm = ({
  orgId,
  teams,
  invalidateInvitations
}: {
  orgId: string
  teams: TeamsListTeams200DataItem[]
  invalidateInvitations: () => Promise<void>
}) => {
  // ── Local UI state ───────────────────────────────────────────────────
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InvitationAssignableRole>('member')
  const [inviteMemberType, setInviteMemberType] = useState<MembershipType>('team')
  const [inviteWorkspaceValues, setInviteWorkspaceValues] = useState<readonly string[]>([ALL_WORKSPACES_VALUE])
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const allWorkspaceOptionDescription = inviteMemberType === 'client'
    ? 'Invite to every current workspace'
    : 'Invite across the whole organization'
  const inviteWorkspaceOptions = useMemo<InviteWorkspaceOption[]>(() => [
    {
      value: ALL_WORKSPACES_VALUE,
      label: 'All workspaces',
      description: allWorkspaceOptionDescription,
      scope: 'all'
    },
    ...teams.map((team) => ({
      value: team.id,
      label: team.name,
      description: 'Add this person to this workspace',
      scope: 'team' as const
    }))
  ], [allWorkspaceOptionDescription, teams])
  const selectedInviteWorkspaceOptions = useMemo(() => {
    const selectedValues = new Set(inviteWorkspaceValues)
    const selectedOptions = inviteWorkspaceOptions.filter((option) => selectedValues.has(option.value))
    return selectedOptions.length > 0 ? selectedOptions : inviteWorkspaceOptions.slice(0, 1)
  }, [inviteWorkspaceOptions, inviteWorkspaceValues])
  const selectedInviteTeamOptions = selectedInviteWorkspaceOptions.filter((option) => option.scope === 'team')
  let inviteWorkspaceSummary = 'All current and future workspaces'
  if (selectedInviteTeamOptions.length > 0) {
    inviteWorkspaceSummary = `${selectedInviteTeamOptions.length} workspace${selectedInviteTeamOptions.length === 1 ? '' : 's'} selected`
  } else if (inviteMemberType === 'client' && teams.length > 0) {
    inviteWorkspaceSummary = `All ${teams.length} current workspace${teams.length === 1 ? '' : 's'}`
  } else if (inviteMemberType === 'client') {
    inviteWorkspaceSummary = 'Create a workspace before inviting clients'
  }
  const resetInviteForm = () => {
    setInviteEmail('')
    setInviteRole('member')
    setInviteMemberType('team')
    setInviteWorkspaceValues([ALL_WORKSPACES_VALUE])
    setInviteError(null)
  }
  const closeInviteDialog = () => {
    setInviteDialogOpen(false)
    resetInviteForm()
  }
  const handleInviteWorkspaceChange = (
    nextOptions: MultiValue<InviteWorkspaceOption>,
    actionMeta: ActionMeta<InviteWorkspaceOption>
  ) => {
    if (inviteError) {
      setInviteError(null)
    }

    if (actionMeta.action === 'select-option' && actionMeta.option?.value === ALL_WORKSPACES_VALUE) {
      setInviteWorkspaceValues([ALL_WORKSPACES_VALUE])
      return
    }

    const selectedTeamValues = nextOptions
      .filter((option) => option.scope === 'team')
      .map((option) => option.value)

    setInviteWorkspaceValues(selectedTeamValues.length > 0 ? selectedTeamValues : [ALL_WORKSPACES_VALUE])
  }

  // ── Handlers ─────────────────────────────────────────────────────────
  const submitInvite = async () => {
    const email = inviteEmail.trim()
    if (!email || inviteSubmitting) {
      return
    }

    setInviteError(null)
    setInviteSubmitting(true)

    const selectedTeamIds = selectedInviteTeamOptions.map((option) => option.value)
    let teamIds = selectedTeamIds
    if (teamIds.length === 0 && inviteMemberType === 'client') {
      teamIds = teams.map((team) => team.id)
    }
    if (inviteMemberType === 'client' && teamIds.length === 0) {
      setInviteError('Create a workspace before inviting a client collaborator')
      setInviteSubmitting(false)
      return
    }
    const invitationTargets: ReadonlyArray<string | undefined> = teamIds.length > 0 ? teamIds : [undefined]

    try {
      const invitationResults = await Promise.allSettled(
        invitationTargets.map((teamId) =>
          organizationsCreateInvitation({
            organizationId: orgId,
            email,
            role: inviteRole,
            teamId,
            membershipType: inviteMemberType
          })
        )
      )
      const successfulInvitationCount = invitationResults.filter((result) => result.status === 'fulfilled').length

      if (successfulInvitationCount === 0) {
        const firstRejectedResult = invitationResults.find((result) => result.status === 'rejected')
        throw firstRejectedResult?.reason
      }

      closeInviteDialog()
      if (successfulInvitationCount === invitationTargets.length) {
        notify.success(
          invitationTargets.length === 1
            ? 'Invitation sent successfully'
            : `${invitationTargets.length} workspace invitations sent successfully`
        )
      } else {
        notify.info(`${successfulInvitationCount} of ${invitationTargets.length} workspace invitations sent. Existing pending invites were skipped.`)
      }
      void invalidateInvitations()
    } catch (error) {
      const message = notify.apiError(error, 'Failed to send invitation')
      setInviteError(message)
    } finally {
      setInviteSubmitting(false)
    }
  }

  return {
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
    resetInviteForm,
    closeInviteDialog,
    handleInviteWorkspaceChange,
    submitInvite
  }
}

export type InviteMemberForm = ReturnType<typeof useInviteMemberForm>
