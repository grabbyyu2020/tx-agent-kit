'use client'

import type { AuthPrincipal, OrgMemberRole } from '@tx-agent-kit/contracts'
import { useMemo, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  useOrganizationsUpdateMemberRole,
  useOrganizationsDisableMember,
  useOrganizationsEnableMember,
  useOrganizationsRemoveMember,
  organizationsDisableMember,
  organizationsRemoveMember
} from '@/lib/api/generated/organizations/organizations'
import type { TeamsListTeams200DataItem } from '@/lib/api/generated/schemas/teamsListTeams200DataItem'
import {
  getTeamsListTeamMembersQueryKey,
  teamsAddTeamMember,
  teamsListTeamMembers,
  teamsRemoveTeamMember
} from '@/lib/api/generated/teams/teams'
import { notify } from '@/lib/notify'
import {
  teamMemberListParams,
  type Member,
  type MemberTeamMembership,
  type TeamMembershipOption
} from './membersLibrary'

export const useMembersTable = ({
  orgId,
  members,
  teams,
  principal,
  currentUserId,
  isAdmin,
  setGuardMessage,
  invalidateMembers
}: {
  orgId: string
  members: Member[]
  teams: TeamsListTeams200DataItem[]
  principal: AuthPrincipal | null
  currentUserId: string | undefined
  isAdmin: boolean
  setGuardMessage: (message: string | null) => void
  invalidateMembers: () => Promise<void>
}) => {
  const queryClient = useQueryClient()

  const invalidateTeamMemberships = () =>
    Promise.all(
      teams.map((team) =>
        queryClient.invalidateQueries({
          queryKey: getTeamsListTeamMembersQueryKey(team.id, teamMemberListParams)
        })
      )
    )

  // ── Mutations ────────────────────────────────────────────────────────
  const updateRoleMutation = useOrganizationsUpdateMemberRole({
    mutation: {
      onSuccess: () => { void invalidateMembers() },
      onError: (error) => { notify.apiError(error, 'Failed to update role') }
    }
  })

  const disableMutation = useOrganizationsDisableMember({
    mutation: {
      onSuccess: () => { void invalidateMembers() },
      onError: (error) => { notify.apiError(error, 'Failed to disable member') }
    }
  })

  const enableMutation = useOrganizationsEnableMember({
    mutation: {
      onSuccess: () => { void invalidateMembers() },
      onError: (error) => { notify.apiError(error, 'Failed to enable member') }
    }
  })

  const removeMutation = useOrganizationsRemoveMember({
    mutation: {
      onSuccess: () => {
        setRemoveConfirm(null)
        void invalidateMembers()
        void invalidateTeamMemberships()
      },
      onError: (error) => { notify.apiError(error, 'Failed to remove member') }
    }
  })

  // ── Local UI state ───────────────────────────────────────────────────
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [bulkRemoveConfirm, setBulkRemoveConfirm] = useState(false)
  const [bulkDisabling, setBulkDisabling] = useState(false)
  const [bulkRemoving, setBulkRemoving] = useState(false)
  const [teamMembershipUpdatingUserId, setTeamMembershipUpdatingUserId] = useState<string | null>(null)
  const memberTeamOptions = useMemo<TeamMembershipOption[]>(
    () => teams.map((team) => ({ value: team.id, label: team.name })),
    [teams]
  )

  // ── Derived state ────────────────────────────────────────────────────
  const adminCount = members.filter((m) => m.role === 'admin' && !m.disabledAt).length
  const isSelf = (member: Member): boolean => member.userId === currentUserId
  const bulkSelectableMembers = members.filter((member) => !isSelf(member))
  const teamMemberQueries = useQueries({
    queries: teams.map((team) => ({
      queryKey: getTeamsListTeamMembersQueryKey(team.id, teamMemberListParams),
      queryFn: ({ signal }) => teamsListTeamMembers(team.id, teamMemberListParams, undefined, signal),
      enabled: !!principal && isAdmin && members.length > 0
    }))
  })
  const teamMembershipsByUserId = new Map<string, MemberTeamMembership[]>()
  teams.forEach((team, index) => {
    const teamMembers = teamMemberQueries[index]?.data?.data ?? []
    teamMembers.forEach((teamMember) => {
      if (teamMember.disabledAt) {
        return
      }
      const existing = teamMembershipsByUserId.get(teamMember.userId) ?? []
      teamMembershipsByUserId.set(teamMember.userId, [
        ...existing,
        {
          teamId: team.id,
          teamMemberId: teamMember.id,
          name: team.name
        }
      ])
    })
  })
  const teamMembershipsLoading = teamMemberQueries.some((query) => query.isLoading || query.isFetching)

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleRoleChange = (member: Member, newRole: OrgMemberRole) => {
    setGuardMessage(null)
    if (member.role === 'admin' && adminCount <= 1 && newRole !== 'admin') {
      setGuardMessage('Cannot change role: must have at least one admin')
      return
    }
    updateRoleMutation.mutate({
      organizationId: orgId,
      memberId: member.id,
      data: { role: newRole as 'admin' | 'member' }
    })
  }

  const handleBulkDisable = async () => {
    if (bulkDisabling) {return}
    setBulkDisabling(true)
    const targets = members.filter(
      (m) => selectedMemberIds.has(m.id) && m.userId !== currentUserId && !m.disabledAt
    )
    let failCount = 0
    for (const member of targets) {
      try {
        await organizationsDisableMember(orgId, member.id)
      } catch (error) {
        failCount++
        notify.apiError(error, `Failed to disable ${member.userName ?? member.userEmail ?? 'member'}`)
      }
    }
    if (failCount === 0 && targets.length > 0) {
      notify.success(`Disabled ${targets.length} member${targets.length !== 1 ? 's' : ''}`)
    }
    setSelectedMemberIds(new Set())
    setBulkDisabling(false)
    void invalidateMembers()
  }

  const handleBulkRemove = async () => {
    if (bulkRemoving) {return}
    setBulkRemoving(true)
    const selectedCount = selectedMemberIds.size
    const targets = members.filter(
      (m) => selectedMemberIds.has(m.id) && m.userId !== currentUserId
    )
    if (selectedCount > 0 && targets.length === 0) {
      notify.error('You cannot remove yourself from the organization. Transfer ownership or ask another admin to remove you.')
      setBulkRemoveConfirm(false)
      setBulkRemoving(false)
      return
    }

    let failCount = 0
    for (const member of targets) {
      try {
        await organizationsRemoveMember(orgId, member.id)
      } catch (error) {
        failCount++
        notify.apiError(error, `Failed to remove ${member.userName ?? member.userEmail ?? 'member'}`)
      }
    }
    if (failCount === 0 && targets.length > 0) {
      notify.success(`Removed ${targets.length} member${targets.length !== 1 ? 's' : ''}`)
    }
    if (selectedCount > targets.length) {
      notify.info('Your own membership was skipped. Transfer ownership before trying to remove yourself.')
    }
    setSelectedMemberIds(new Set())
    setBulkRemoveConfirm(false)
    setBulkRemoving(false)
    void invalidateMembers()
  }

  const handleMemberTeamsChange = async (
    member: Member,
    selectedOptions: readonly TeamMembershipOption[]
  ) => {
    if (teamMembershipUpdatingUserId) {
      return
    }

    const currentMemberships = teamMembershipsByUserId.get(member.userId) ?? []
    const currentTeamIds = new Set(currentMemberships.map((membership) => membership.teamId))
    const selectedTeamIds = new Set(selectedOptions.map((option) => option.value))

    if (currentMemberships.length > 0 && selectedTeamIds.size === 0) {
      if (isSelf(member)) {
        notify.error('You cannot remove yourself from every workspace from this table.')
        return
      }

      const confirmed = window.confirm('Are you sure you want to delete this person from the organization?')
      if (!confirmed) {
        return
      }

      removeMutation.mutate({ organizationId: orgId, memberId: member.id })
      return
    }

    const teamIdsToAdd = [...selectedTeamIds].filter((teamId) => !currentTeamIds.has(teamId))
    const membershipsToRemove = currentMemberships.filter((membership) => !selectedTeamIds.has(membership.teamId))

    if (teamIdsToAdd.length === 0 && membershipsToRemove.length === 0) {
      return
    }

    setTeamMembershipUpdatingUserId(member.userId)
    try {
      for (const teamId of teamIdsToAdd) {
        await teamsAddTeamMember(teamId, { userId: member.userId })
      }

      for (const membership of membershipsToRemove) {
        await teamsRemoveTeamMember(membership.teamId, membership.teamMemberId)
      }

      notify.success('Workspace access updated')
      void invalidateTeamMemberships()
    } catch (error) {
      notify.apiError(error, 'Failed to update workspace access')
    } finally {
      setTeamMembershipUpdatingUserId(null)
    }
  }

  return {
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
  }
}
