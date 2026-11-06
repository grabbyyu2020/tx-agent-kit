import { Context, Effect, Layer } from 'effect'
import type { CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import type {
  CreateTeamCommand,
  TeamRecord,
  TeamMemberRecord,
  UpdateTeamCommand
} from '../domain/team-domain.js'
import type {
  ContentReviewTokenStorePort,
  ContentReviewTokenRecord,
  TeamStorePort,
  TeamOrganizationMembershipPort
} from '../ports/team-ports.js'
import { teamCrudUseCases } from './team-crud-use-cases.js'
import { teamMemberUseCases } from './team-member-use-cases.js'
import { teamReviewTokenUseCases } from './team-review-token-use-cases.js'

export class TeamService extends Context.Tag('TeamService')<
  TeamService,
  {
    listForOrganization: (
      principal: { userId: string },
      organizationId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<TeamRecord>, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    getById: (
      principal: { userId: string },
      id: string
    ) => Effect.Effect<TeamRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    create: (
      principal: { userId: string },
      input: CreateTeamCommand
    ) => Effect.Effect<TeamRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    update: (
      principal: { userId: string },
      id: string,
      input: UpdateTeamCommand
    ) => Effect.Effect<TeamRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    remove: (
      principal: { userId: string },
      id: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    addMember: (
      principal: { userId: string },
      teamId: string,
      userId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    removeMember: (
      principal: { userId: string },
      teamId: string,
      userId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    listMembers: (
      principal: { userId: string },
      teamId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<TeamMemberRecord>, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    addMemberById: (
      principal: { userId: string },
      teamId: string,
      userId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    getMemberById: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    updateMemberRole: (
      principal: { userId: string },
      teamId: string,
      memberId: string,
      roleId: string | null
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    disableTeamMember: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    enableTeamMember: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<TeamMemberRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    removeTeamMember: (
      principal: { userId: string },
      teamId: string,
      memberId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort>
    createReviewToken: (
      principal: { userId: string },
      teamId: string,
      input: {
        permissions: string[]
        reviewerName?: string | null
        reviewerEmail?: string | null
        expiresInDays?: number
      }
    ) => Effect.Effect<ContentReviewTokenRecord, CoreError, TeamStorePort | TeamOrganizationMembershipPort | ContentReviewTokenStorePort>
    listReviewTokens: (
      principal: { userId: string },
      teamId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<ContentReviewTokenRecord>, CoreError, TeamStorePort | TeamOrganizationMembershipPort | ContentReviewTokenStorePort>
    revokeReviewToken: (
      principal: { userId: string },
      teamId: string,
      tokenId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, TeamStorePort | TeamOrganizationMembershipPort | ContentReviewTokenStorePort>
    validateReviewToken: (
      token: string
    ) => Effect.Effect<{
      valid: boolean
      token?: ContentReviewTokenRecord
      teamId?: string
      permissions?: string[]
    }, CoreError, ContentReviewTokenStorePort>
  }
>() {}

// Use cases live in sibling modules grouped by responsibility; the key
// order below matches the original single-literal implementation.
export const TeamServiceLive = Layer.effect(
  TeamService,
  Effect.succeed({
    ...teamCrudUseCases,
    ...teamMemberUseCases,
    ...teamReviewTokenUseCases
  })
)
