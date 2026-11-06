import { Effect, Option } from 'effect'
import { forbidden, internalError, type CoreError } from '../../../errors.js'
import { TeamStorePort, TeamOrganizationMembershipPort } from '../ports/team-ports.js'

export const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)

export const requireOrgMembership = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const orgMembershipPort = yield* TeamOrganizationMembershipPort
    const isMember = yield* orgMembershipPort.isMember(organizationId, userId).pipe(
      Effect.mapError(toCoreInternal('Failed to verify organization membership'))
    )
    if (!isMember) {
      return yield* Effect.fail(forbidden('Not allowed to access this organization'))
    }
    const disabledAt = yield* orgMembershipPort.getOrgMemberDisabledAt(organizationId, userId).pipe(
      Effect.mapError(toCoreInternal('Failed to check membership disabled status'))
    )
    if (disabledAt !== null) {
      return yield* Effect.fail(forbidden('Your organization membership has been disabled'))
    }
  })

export const requireOrgAdmin = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const orgMembershipPort = yield* TeamOrganizationMembershipPort
    const role = yield* orgMembershipPort.getMemberRole(organizationId, userId).pipe(
      Effect.mapError(toCoreInternal('Failed to verify organization role'))
    )
    if (role !== 'admin') {
      return yield* Effect.fail(forbidden('Only admins can manage team members'))
    }
  })

export const requireOrgAdminOrTeamMembership = (organizationId: string, teamId: string, userId: string) =>
  Effect.gen(function* () {
    yield* requireOrgMembership(organizationId, userId)

    const orgMembershipPort = yield* TeamOrganizationMembershipPort
    const role = yield* orgMembershipPort.getMemberRole(organizationId, userId).pipe(
      Effect.mapError(toCoreInternal('Failed to verify organization role'))
    )

    if (role === 'admin') {
      return
    }

    const teamStore = yield* TeamStorePort
    const teamMember = yield* teamStore.getMemberByTeamAndUser(teamId, userId).pipe(
      Effect.mapError(toCoreInternal('Failed to resolve team membership')),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(forbidden('You are not a member of this team')),
        onSome: Effect.succeed
      }))
    )

    if (teamMember.disabledAt !== null) {
      return yield* Effect.fail(forbidden('Your team membership has been disabled'))
    }
  })
