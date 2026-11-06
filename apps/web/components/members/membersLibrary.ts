import type { OrgMemberRole } from '@tx-agent-kit/contracts'
import type { OrganizationsListOrgMembers200DataItem } from '@/lib/api/generated/schemas/organizationsListOrgMembers200DataItem'

export type Member = OrganizationsListOrgMembers200DataItem
export const ALL_WORKSPACES_VALUE = '__all_workspaces__'
export const teamMemberListParams = { limit: '100' } as const

export interface InviteWorkspaceOption {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly scope: 'all' | 'team'
}

export interface TeamMembershipOption {
  readonly value: string
  readonly label: string
}

export interface MemberTeamMembership {
  readonly teamId: string
  readonly teamMemberId: string
  readonly name: string
}

export const roleBadgeVariant = (role: OrgMemberRole) => {
  if (role === 'admin') {return 'default' as const}
  if (role === 'member') {return 'secondary' as const}
  return 'outline' as const
}
