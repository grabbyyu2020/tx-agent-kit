'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../hooks/use-session-store'
import { isUuid, NIL_UUID } from '../../../../../lib/id-validation'
import {
  useOrganizationsListOrgMembers,
  useOrganizationsListOrgInvitations,
  getOrganizationsListOrgMembersQueryKey,
  getOrganizationsListOrgInvitationsQueryKey
} from '../../../../../lib/api/generated/organizations/organizations'
import { useTeamsListTeams } from '../../../../../lib/api/generated/teams/teams'
import { InviteMemberDialog } from '@/components/members/InviteMemberDialog'
import { MembersTableCard } from '@/components/members/MembersTableCard'
import { PendingInvitationsTable } from '@/components/members/PendingInvitationsTable'
import { TransferOwnershipDialog } from '@/components/members/TransferOwnershipDialog'
import { useInviteMemberForm } from '@/components/members/useInviteMemberForm'

export default function MembersPage() {
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const hasValidOrgId = isUuid(orgId)
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()

  // ── Queries ──────────────────────────────────────────────────────────
  const membersQuery = useOrganizationsListOrgMembers(orgId, undefined, {
    query: {}
  })
  const invitationsQuery = useOrganizationsListOrgInvitations(
    orgId,
    { 'filter[status]': 'pending' },
    { query: { enabled: !!principal } }
  )
  const teamsQuery = useTeamsListTeams(
    { organizationId: hasValidOrgId ? orgId : NIL_UUID, limit: '100', sortBy: 'name', sortOrder: 'asc' },
    { query: { enabled: hasValidOrgId && !!principal } }
  )

  const members = membersQuery.data?.data ?? []
  const invitations = invitationsQuery.data?.data ?? []
  const teams = teamsQuery.data?.data ?? []
  const loading = membersQuery.isLoading
  const error = membersQuery.error ? 'Failed to load members' : null

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationsListOrgMembersQueryKey(orgId) })
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationsListOrgInvitationsQueryKey(orgId, { 'filter[status]': 'pending' }) })

  // ── Local UI state ───────────────────────────────────────────────────
  const [guardMessage, setGuardMessage] = useState<string | null>(null)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const inviteForm = useInviteMemberForm({ orgId, teams, invalidateInvitations })

  // ── Derived state ────────────────────────────────────────────────────
  const currentUserId = principal?.userId
  const currentMember = members.find((m) => m.userId === currentUserId)
  const isAdmin = currentMember?.role === 'admin'

  return (
    <DashboardShell
      title="Organization Members"
      subtitle="Manage members, roles, and access for this organization."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {guardMessage && <p className="text-sm text-destructive">{guardMessage}</p>}

      {loading && members.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {!loading && members.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No members yet.</p>
        </div>
      )}

      <MembersTableCard
        orgId={orgId}
        members={members}
        teams={teams}
        principal={principal}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        setGuardMessage={setGuardMessage}
        invalidateMembers={invalidateMembers}
        resetInviteForm={inviteForm.resetInviteForm}
        setInviteDialogOpen={inviteForm.setInviteDialogOpen}
        setTransferDialogOpen={setTransferDialogOpen}
      />

      <PendingInvitationsTable
        invitations={invitations}
        teams={teams}
        isAdmin={isAdmin}
        invalidateInvitations={invalidateInvitations}
      />

      <TransferOwnershipDialog
        orgId={orgId}
        isAdmin={isAdmin}
        members={members}
        currentUserId={currentUserId}
        transferDialogOpen={transferDialogOpen}
        setTransferDialogOpen={setTransferDialogOpen}
        invalidateMembers={invalidateMembers}
      />

      <InviteMemberDialog form={inviteForm} teams={teams} />
    </DashboardShell>
  )
}
