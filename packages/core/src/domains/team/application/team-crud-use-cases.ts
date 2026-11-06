import { type Context, Effect, Option } from 'effect'
import { badRequest, internalError, notFound } from '../../../errors.js'
import {
  isValidBrandSettings,
  isValidTeamName,
  normalizeTeamName
} from '../domain/team-domain.js'
import { TeamStorePort, TeamOrganizationMembershipPort } from '../ports/team-ports.js'
import type { TeamService } from './team-service.js'
import {
  requireOrgAdmin,
  requireOrgAdminOrTeamMembership,
  requireOrgMembership,
  toCoreInternal
} from './team-use-case-support.js'

type TeamServiceShape = Context.Tag.Service<typeof TeamService>

export const teamCrudUseCases: Pick<
  TeamServiceShape,
  | 'listForOrganization'
  | 'getById'
  | 'create'
  | 'update'
  | 'remove'
> = {
  listForOrganization: (principal, organizationId, params) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort
      yield* requireOrgMembership(organizationId, principal.userId)

      const orgMembershipPort = yield* TeamOrganizationMembershipPort
      const role = yield* orgMembershipPort.getMemberRole(organizationId, principal.userId).pipe(
        Effect.mapError(toCoreInternal('Failed to verify organization role'))
      )
      const page = yield* (role === 'admin'
        ? teamStore.list(organizationId, params)
        : teamStore.listForMember(organizationId, principal.userId, params)
      ).pipe(
        Effect.mapError(toCoreInternal('Failed to list teams'))
      )

      return page
    }),

  getById: (principal, id) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const team = yield* teamStore.getById(id).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgAdminOrTeamMembership(team.organizationId, id, principal.userId)

      return team
    }),

  create: (principal, input) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      if (!isValidTeamName(input.name)) {
        return yield* Effect.fail(badRequest('Invalid team payload'))
      }

      if (!isValidBrandSettings(input.brandSettings)) {
        return yield* Effect.fail(badRequest('Invalid brand settings'))
      }

      const name = normalizeTeamName(input.name)
      yield* requireOrgMembership(input.organizationId, principal.userId)

      const created = yield* teamStore.create({
        organizationId: input.organizationId,
        name,
        website: input.website ?? null,
        brandSettings: input.brandSettings
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to create team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(badRequest('Team creation failed')),
          onSome: Effect.succeed
        }))
      )

      // Auto-add the creator as an admin team member so they can manage the team.
      // The auto-join trigger may have already added them as 'member' — the role
      // parameter triggers onConflictDoUpdate to promote to admin.
      yield* teamStore.addMember({ teamId: created.id, userId: principal.userId, role: 'admin' }).pipe(
        Effect.mapError(toCoreInternal('Failed to add creator as team member')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(internalError('Failed to add creator as team member')),
          onSome: Effect.succeed
        }))
      )

      return created
    }),

  update: (principal, id, input) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const existing = yield* teamStore.getById(id).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(existing.organizationId, principal.userId)
      yield* requireOrgAdmin(existing.organizationId, principal.userId)

      if (input.name === undefined && input.website === undefined && input.brandSettings === undefined) {
        return yield* Effect.fail(badRequest('Team update payload is empty'))
      }

      if (input.name !== undefined && !isValidTeamName(input.name)) {
        return yield* Effect.fail(badRequest('Invalid team update payload'))
      }

      if (input.brandSettings !== undefined && input.brandSettings !== null) {
        if (!isValidBrandSettings(input.brandSettings)) {
          return yield* Effect.fail(badRequest('Invalid brand settings'))
        }
      }

      const patch: { id: string; name?: string; website?: string | null; brandSettings?: typeof input.brandSettings } = { id }

      if (input.name !== undefined) {
        patch.name = normalizeTeamName(input.name)
      }

      if (input.website !== undefined) {
        patch.website = input.website
      }

      if (input.brandSettings !== undefined) {
        patch.brandSettings = input.brandSettings
      }

      const updated = yield* teamStore.update(patch).pipe(
        Effect.mapError(toCoreInternal('Failed to update team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      return updated
    }),

  remove: (principal, id) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort

      const existing = yield* teamStore.getById(id).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(existing.organizationId, principal.userId)
      yield* requireOrgAdmin(existing.organizationId, principal.userId)

      return yield* teamStore.removeWithEvent({
        id,
        event: {
          eventType: 'team.deleted',
          aggregateType: 'team',
          payload: {
            teamId: id,
            teamName: existing.name,
            organizationId: existing.organizationId,
            deletedByUserId: principal.userId
          }
        }
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to delete team'))
      )
    })
}
