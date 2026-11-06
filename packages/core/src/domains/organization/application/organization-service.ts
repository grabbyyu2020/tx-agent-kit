import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, notFound, unauthorized, type CoreError } from '../../../errors.js'
import type { ListParams, PaginatedResult } from '../../../pagination.js'
import {
  canDeleteOrganization,
  canManageOrganization,
  isValidOrganizationName,
  normalizeOrganizationName,
  type CreateInvitationCommand,
  type CreateOrganizationCommand,
  type InvitationRecord,
  type OrgMemberRecord,
  type OrgMemberRole,
  type OrganizationRecord,
  type UpdateInvitationCommand,
  type UpdateOrganizationCommand
} from '../domain/organization-domain.js'
import {
  OrganizationMemberStorePort,
  OrganizationStorePort,
  type InvitationEmailPort,
  type OrganizationInvitationStorePort,
  type OrganizationUsersPort
} from '../ports/organization-ports.js'
import { organizationInvitationUseCases } from './organization-invitation-use-cases.js'
import { toCoreInternal } from './organization-use-case-support.js'

export class OrganizationService extends Context.Tag('OrganizationService')<
  OrganizationService,
  {
    listForUser: (
      userId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<OrganizationRecord>, CoreError, OrganizationStorePort>
    getById: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<OrganizationRecord, CoreError, OrganizationStorePort>
    getManyByIds: (
      principal: { userId: string },
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<OrganizationRecord>, CoreError, OrganizationStorePort>
    createForUser: (userId: string, input: CreateOrganizationCommand, options?: { email?: string }) => Effect.Effect<OrganizationRecord, CoreError, OrganizationStorePort>
    updateById: (
      principal: { userId: string },
      organizationId: string,
      input: UpdateOrganizationCommand
    ) => Effect.Effect<OrganizationRecord, CoreError, OrganizationStorePort>
    removeById: (
      principal: { userId: string },
      organizationId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, OrganizationStorePort>
    listInvitationsForUser: (
      principal: { userId: string; email: string },
      params: ListParams
    ) => Effect.Effect<PaginatedResult<InvitationRecord>, CoreError, OrganizationInvitationStorePort>
    listOrgInvitations: (
      principal: { userId: string },
      organizationId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<InvitationRecord>, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    getInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string
    ) => Effect.Effect<InvitationRecord, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    getManyInvitationsByIds: (
      principal: { userId: string; email: string },
      ids: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<InvitationRecord>, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    updateInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string,
      input: UpdateInvitationCommand
    ) => Effect.Effect<InvitationRecord, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    removeInvitationById: (
      principal: { userId: string; email: string },
      invitationId: string
    ) => Effect.Effect<{ deleted: true }, CoreError, OrganizationStorePort | OrganizationInvitationStorePort>
    createInvitation: (
      principal: { userId: string; email: string },
      input: CreateInvitationCommand
    ) => Effect.Effect<
      InvitationRecord,
      CoreError,
      OrganizationStorePort | OrganizationInvitationStorePort | OrganizationUsersPort | InvitationEmailPort
    >
    acceptInvitation: (
      principal: { userId: string; email: string },
      token: string
    ) => Effect.Effect<{ accepted: true }, CoreError, OrganizationInvitationStorePort>
    getMemberRole: (
      organizationId: string,
      userId: string
    ) => Effect.Effect<OrgMemberRole | null, CoreError, OrganizationStorePort>
    listOrgMembers: (
      principal: { userId: string },
      organizationId: string,
      params: ListParams
    ) => Effect.Effect<PaginatedResult<OrgMemberRecord>, CoreError, OrganizationStorePort | OrganizationMemberStorePort>
  }
>() {}

export const OrganizationServiceLive = Layer.effect(
  OrganizationService,
  Effect.succeed({
    listForUser: (userId: string, params: ListParams) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort
        const page = yield* organizationStore.listForUser(userId, params).pipe(
          Effect.mapError(toCoreInternal('Failed to list organizations'))
        )

        return page
      }),

    getById: (principal, organizationId: string) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        const organization = yield* organizationStore.getById(organizationId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch organization')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        const isMember = yield* organizationStore.isMember(organizationId, principal.userId).pipe(
          Effect.mapError(toCoreInternal('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this organization'))
        }

        return organization
      }),

    getManyByIds: (principal, ids) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        if (ids.length === 0) {
          return [] as const
        }

        const rows = yield* organizationStore.getManyByIdsForUser(principal.userId, ids).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch organizations'))
        )

        const byId = new Map(rows.map((row) => [row.id, row] as const))
        return ids.flatMap((id) => {
          const row = byId.get(id)
          return row ? [row] : []
        })
      }),

    createForUser: (userId: string, input, options) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        if (!isValidOrganizationName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid organization payload'))
        }

        const name = normalizeOrganizationName(input.name)

        const created = yield* organizationStore.createWithEvent({
          name,
          ownerUserId: userId,
          event: {
            eventType: 'organization.created',
            aggregateType: 'organization',
            payload: { organizationName: name, ownerUserId: userId, ownerEmail: options?.email ?? '' }
          }
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to create organization')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Organization creation failed')),
            onSome: Effect.succeed
          }))
        )

        return created
      }),

    updateById: (principal, organizationId: string, input) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        yield* organizationStore.getById(organizationId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch organization')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        const role = yield* organizationStore.getMemberRole(organizationId, principal.userId).pipe(
          Effect.mapError((cause) => unauthorized('Not allowed to update organization', cause))
        )

        const roleValue = Option.getOrNull(role)
        if (!roleValue || !canManageOrganization(roleValue)) {
          return yield* Effect.fail(unauthorized('Only admins and owners can update organizations'))
        }

        if (input.name === undefined && input.onboardingData === undefined) {
          return yield* Effect.fail(badRequest('Organization update payload is empty'))
        }

        if (input.name !== undefined && !isValidOrganizationName(input.name)) {
          return yield* Effect.fail(badRequest('Invalid organization update payload'))
        }

        const updated = yield* organizationStore.update({
          id: organizationId,
          name: input.name === undefined ? undefined : normalizeOrganizationName(input.name),
          onboardingData: input.onboardingData
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to update organization')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        return updated
      }),

    removeById: (principal, organizationId: string) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort

        const organization = yield* organizationStore.getById(organizationId).pipe(
          Effect.mapError(toCoreInternal('Failed to fetch organization')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('Organization not found')),
            onSome: Effect.succeed
          }))
        )

        const role = yield* organizationStore.getMemberRole(organizationId, principal.userId).pipe(
          Effect.mapError((cause) => unauthorized('Not allowed to delete organization', cause))
        )

        const roleValue = Option.getOrNull(role)
        if (!roleValue || !canDeleteOrganization(roleValue)) {
          return yield* Effect.fail(unauthorized('Only organization owners can delete organizations'))
        }

        return yield* organizationStore.removeWithEvent({
          id: organizationId,
          event: {
            eventType: 'organization.deleted',
            aggregateType: 'organization',
            payload: {
              organizationId,
              organizationName: organization.name,
              deletedByUserId: principal.userId
            }
          }
        }).pipe(
          Effect.mapError(toCoreInternal('Failed to delete organization'))
        )
      }),

    // Invitation use cases live in a sibling module; the key order below
    // matches the original single-literal implementation.
    ...organizationInvitationUseCases,

    getMemberRole: (organizationId, userId) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort
        const role = yield* organizationStore.getMemberRole(organizationId, userId).pipe(
          Effect.mapError(toCoreInternal('Failed to retrieve member role'))
        )
        return Option.getOrNull(role)
      }),

    listOrgMembers: (principal, organizationId, params) =>
      Effect.gen(function* () {
        const organizationStore = yield* OrganizationStorePort
        const memberStore = yield* OrganizationMemberStorePort

        const isMember = yield* organizationStore.isMember(organizationId, principal.userId).pipe(
          Effect.mapError(toCoreInternal('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not allowed to access this organization'))
        }

        const page = yield* memberStore.listMembers(organizationId, params).pipe(
          Effect.mapError(toCoreInternal('Failed to list organization members'))
        )

        return page
      })
  })
)
