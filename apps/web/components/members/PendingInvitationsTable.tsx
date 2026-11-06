'use client'

import { useState } from 'react'
import { useOrganizationsRemoveInvitation } from '@/lib/api/generated/organizations/organizations'
import type { OrganizationsListOrgInvitations200DataItem } from '@/lib/api/generated/schemas/organizationsListOrgInvitations200DataItem'
import type { TeamsListTeams200DataItem } from '@/lib/api/generated/schemas/teamsListTeams200DataItem'
import { notify } from '@/lib/notify'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { roleBadgeVariant } from './membersLibrary'

const invitationStatusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="border-yellow-500 bg-yellow-50 text-yellow-700">pending</Badge>
    case 'accepted':
      return <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700">accepted</Badge>
    case 'revoked':
      return <Badge variant="outline" className="border-red-500 bg-red-50 text-red-700">revoked</Badge>
    case 'expired':
      return <Badge variant="outline" className="border-gray-400 bg-gray-50 text-gray-500">expired</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function PendingInvitationsTable({
  invitations,
  teams,
  isAdmin,
  invalidateInvitations
}: {
  invitations: OrganizationsListOrgInvitations200DataItem[]
  teams: TeamsListTeams200DataItem[]
  isAdmin: boolean
  invalidateInvitations: () => Promise<void>
}) {
  const revokeInvitationMutation = useOrganizationsRemoveInvitation({
    mutation: {
      onSuccess: () => {
        setRevokeConfirmId(null)
        void invalidateInvitations()
      },
      onError: (error) => { notify.apiError(error, 'Failed to revoke invitation') }
    }
  })

  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)
  const pendingInvitations = invitations.filter((inv) => inv.status === 'pending')
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]))

  return (
    <>
      {pendingInvitations.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-base font-semibold">Pending Invitations</h2>
          <Card className="overflow-hidden border-border/80 shadow-sm">
            <Table className="[&_td]:px-8 [&_td]:py-5 [&_th]:px-8 [&_th]:py-4">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="w-[160px] text-center">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((invitation) => (
                  <TableRow key={invitation.id} data-testid="invitation-row">
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {invitation.teamId ? (teamNameById.get(invitation.teamId) ?? 'Assigned workspace') : 'All workspaces'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={invitation.membershipType === 'client' ? 'secondary' : 'outline'}>
                        {invitation.membershipType === 'client' ? 'client' : 'team'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant(invitation.role)}>{invitation.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {invitationStatusBadge(invitation.status)}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-center">
                        {revokeConfirmId === invitation.id ? (
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-sm text-muted-foreground">Revoke?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={revokeInvitationMutation.isPending}
                              onClick={() => revokeInvitationMutation.mutate({ invitationId: invitation.id })}
                            >
                              {revokeInvitationMutation.isPending ? 'Revoking...' : 'Confirm'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={revokeInvitationMutation.isPending}
                              onClick={() => setRevokeConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            aria-label="Revoke invitation"
                            onClick={() => setRevokeConfirmId(invitation.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  )
}
