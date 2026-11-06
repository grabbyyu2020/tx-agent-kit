import { type Context, Effect, Option } from 'effect'
import { conflict, internalError, notFound } from '../../../errors.js'
import { TeamStorePort, TeamOrganizationMembershipPort } from '../ports/team-ports.js'
import type { TeamService } from './team-service.js'
import {
  requireOrgAdmin,
  requireOrgAdminOrTeamMembership,
  requireOrgMembership,
  toCoreInternal
} from './team-use-case-support.js'

type TeamServiceShape = Context.Tag.Service<typeof TeamService>

export const teamMemberUseCases: Pick<
  TeamServiceShape,
  | 'addMember'
  | 'removeMember'
  | 'listMembers'
  | 'addMemberById'
  | 'getMemberById'
  | 'updateMemberRole'
  | 'disableTeamMember'
  | 'enableTeamMember'
  | 'removeTeamMember'
> = {
  addMember: (principal, teamId, userId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort
      const orgMembershipPort = yield* TeamOrganizationMembershipPort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      // Verify target user is a member of the same organization
      const targetIsMember = yield* orgMembershipPort.isMember(team.organizationId, userId).pipe(
        Effect.mapError(toCoreInternal('Failed to verify user membership'))
      )
      if (!targetIsMember) {
        return yield* Effect.fail(notFound('User is not a member of this organization'))
      }

      const added = yield* teamStore.addMember({ teamId, userId }).pipe(
        Effect.mapError(toCoreInternal('Failed to add team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(internalError('Failed to add team member')),
          onSome: Effect.succeed
        }))
      )

      return added
    }),

  removeMember: (principal, teamId, userId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      return yield* teamStore.removeMember(teamId, userId).pipe(
        Effect.mapError(toCoreInternal('Failed to remove team member'))
      )
    }),

  listMembers: (principal, teamId, params) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgAdminOrTeamMembership(team.organizationId, teamId, principal.userId)

      return yield* teamStore.listMembers(teamId, params).pipe(
        Effect.mapError(toCoreInternal('Failed to list team members'))
      )
    }),

  addMemberById: (principal, teamId, userId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort
      const orgMembershipPort = yield* TeamOrganizationMembershipPort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      // Verify target user is a member of the same organization
      const targetIsMember = yield* orgMembershipPort.isMember(team.organizationId, userId).pipe(
        Effect.mapError(toCoreInternal('Failed to verify user membership'))
      )
      if (!targetIsMember) {
        return yield* Effect.fail(notFound('User is not a member of this organization'))
      }

      // Check if user is already a member of the team
      const existingOpt = yield* teamStore.getMemberByTeamAndUser(teamId, userId).pipe(
        Effect.mapError(toCoreInternal('Failed to check existing team member'))
      )

      if (Option.isSome(existingOpt)) {
        return yield* Effect.fail(conflict('User is already a member of this team'))
      }

      const added = yield* teamStore.addMember({ teamId, userId }).pipe(
        Effect.mapError(toCoreInternal('Failed to add team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(internalError('Failed to add team member')),
          onSome: Effect.succeed
        }))
      )

      return added
    }),

  getMemberById: (principal, teamId, memberId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)

      const member = yield* teamStore.getMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      if (member.teamId !== teamId) {
        return yield* Effect.fail(notFound('Team member not found'))
      }

      return member
    }),

  updateMemberRole: (principal, teamId, memberId, roleId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      const existing = yield* teamStore.getMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      if (existing.teamId !== teamId) {
        return yield* Effect.fail(notFound('Team member not found'))
      }

      const updated = yield* teamStore.updateMemberRole(memberId, roleId).pipe(
        Effect.mapError(toCoreInternal('Failed to update team member role')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      return updated
    }),

  disableTeamMember: (principal, teamId, memberId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      const existing = yield* teamStore.getMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      if (existing.teamId !== teamId) {
        return yield* Effect.fail(notFound('Team member not found'))
      }

      const disabled = yield* teamStore.disableMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to disable team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      return disabled
    }),

  enableTeamMember: (principal, teamId, memberId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      const existing = yield* teamStore.getMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      if (existing.teamId !== teamId) {
        return yield* Effect.fail(notFound('Team member not found'))
      }

      const enabled = yield* teamStore.enableMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to enable team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      return enabled
    }),

  removeTeamMember: (principal, teamId, memberId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      const existing = yield* teamStore.getMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team member not found')),
          onSome: Effect.succeed
        }))
      )

      if (existing.teamId !== teamId) {
        return yield* Effect.fail(notFound('Team member not found'))
      }

      yield* teamStore.removeMemberById(memberId).pipe(
        Effect.mapError(toCoreInternal('Failed to remove team member'))
      )

      return { deleted: true as const }
    })
}
