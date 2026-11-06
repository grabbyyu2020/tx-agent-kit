import { type Context, Effect, Option } from 'effect'
import { badRequest, conflict, internalError, notFound, unauthorized, type CoreError } from '../../../errors.js'
import type { ListParams } from '../../../pagination.js'
import {
  canCreateInvitation,
  canManageInvitation,
  isValidInvitationEmail,
  isValidInvitationRoleUpdate,
  isValidInvitationStatusUpdate,
  normalizeInvitationEmail,
  type InvitationRecord,
  type OrgMemberRole
} from '../domain/organization-domain.js'
import {
  InvitationEmailPort,
  OrganizationInvitationStorePort,
  OrganizationStorePort,
  OrganizationUsersPort
} from '../ports/organization-ports.js'
import type { OrganizationService } from './organization-service.js'
import { toCoreInternal } from './organization-use-case-support.js'

const hasInvitationReadAccess = (
  principal: { userId: string; email: string },
  invitation: InvitationRecord,
  organizationRole: OrgMemberRole | null
): boolean => {
  if (invitation.inviteeUserId === principal.userId) {
    return true
  }

  if (normalizeInvitationEmail(invitation.email) === normalizeInvitationEmail(principal.email)) {
    return true
  }

  return organizationRole === 'admin'
}

const invitationOrgwidePendingUniqueViolationCode = 'DB_INVITATION_ORGWIDE_PENDING_UNIQUE_VIOLATION'
const invitationTeamPendingUniqueViolationCode = 'DB_INVITATION_TEAM_PENDING_UNIQUE_VIOLATION'

const pendingInvitationConflictMessage = (teamId?: string): string =>
  teamId
    ? 'A pending invitation already exists for this email and workspace'
    : 'A pending organization invitation already exists for this email'

const getErrorCode = (cause: unknown, depth = 0): string | null => {
  if (depth > 4 || typeof cause !== 'object' || cause === null) {
    return null
  }

  const candidate = cause as {
    readonly code?: unknown
    readonly cause?: unknown
    readonly error?: unknown
  }
  if (typeof candidate.code === 'string') {
    return candidate.code
  }

  return getErrorCode(candidate.cause, depth + 1)
    ?? getErrorCode(candidate.error, depth + 1)
}

const mapCreateInvitationError = (cause: unknown, teamId?: string): CoreError => {
  const errorCode = getErrorCode(cause)
  if (errorCode === invitationTeamPendingUniqueViolationCode) {
    return conflict(pendingInvitationConflictMessage(teamId ?? 'workspace'), cause)
  }

  if (errorCode === invitationOrgwidePendingUniqueViolationCode) {
    return conflict(pendingInvitationConflictMessage(), cause)
  }

  return internalError('Failed to create invitation', cause)
}

type OrganizationServiceShape = Context.Tag.Service<typeof OrganizationService>

export const organizationInvitationUseCases: Pick<
  OrganizationServiceShape,
  | 'listInvitationsForUser'
  | 'listOrgInvitations'
  | 'getInvitationById'
  | 'getManyInvitationsByIds'
  | 'updateInvitationById'
  | 'removeInvitationById'
  | 'createInvitation'
  | 'acceptInvitation'
> = {
  listInvitationsForUser: (principal, params: ListParams) =>
    Effect.gen(function* () {
      const invitationStore = yield* OrganizationInvitationStorePort
      const page = yield* invitationStore.listForInviteeUserId(
        principal.userId,
        normalizeInvitationEmail(principal.email),
        params
      ).pipe(
        Effect.mapError(toCoreInternal('Failed to list invitations'))
      )

      return {
        data: page.data,
        total: page.total,
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor
      }
    }),

  listOrgInvitations: (principal, organizationId: string, params: ListParams) =>
    Effect.gen(function* () {
      const organizationStore = yield* OrganizationStorePort
      const invitationStore = yield* OrganizationInvitationStorePort

      const role = yield* organizationStore.getMemberRole(organizationId, principal.userId).pipe(
        Effect.mapError((cause) => unauthorized('Not a member of this organization', cause))
      )

      const roleValue = Option.getOrNull(role)
      if (!roleValue || roleValue !== 'admin') {
        return yield* Effect.fail(unauthorized('Only admins can list organization invitations'))
      }

      const page = yield* invitationStore.listForOrganization(organizationId, params).pipe(
        Effect.mapError(toCoreInternal('Failed to list organization invitations'))
      )

      return {
        data: page.data,
        total: page.total,
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor
      }
    }),

  getInvitationById: (principal, invitationId: string) =>
    Effect.gen(function* () {
      const invitationStore = yield* OrganizationInvitationStorePort
      const organizationStore = yield* OrganizationStorePort

      const invitation = yield* invitationStore.getById(invitationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch invitation')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Invitation not found')),
          onSome: Effect.succeed
        }))
      )

      const role = yield* organizationStore.getMemberRole(invitation.organizationId, principal.userId).pipe(
        Effect.mapError(toCoreInternal('Failed to verify invitation access'))
      )

      if (!hasInvitationReadAccess(principal, invitation, Option.getOrNull(role))) {
        return yield* Effect.fail(unauthorized('Not allowed to access this invitation'))
      }

      return invitation
    }),

  getManyInvitationsByIds: (principal, ids) =>
    Effect.gen(function* () {
      const invitationStore = yield* OrganizationInvitationStorePort
      const organizationStore = yield* OrganizationStorePort

      if (ids.length === 0) {
        return [] as const
      }

      const rows = yield* invitationStore.getManyByIds(ids).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch invitations'))
      )

      const uniqueOrganizationIds = [...new Set(rows.map((row) => row.organizationId))]
      const organizationRoles = yield* organizationStore
        .getMemberRolesForUser(principal.userId, uniqueOrganizationIds)
        .pipe(Effect.mapError(toCoreInternal('Failed to verify invitation access')))

      const accessibleRows = rows.filter((invitation) =>
        hasInvitationReadAccess(
          principal,
          invitation,
          organizationRoles.get(invitation.organizationId) ?? null
        )
      )

      const byId = new Map(accessibleRows.map((row) => [row.id, row] as const))
      return ids.flatMap((id) => {
        const row = byId.get(id)
        return row ? [row] : []
      })
    }),

  updateInvitationById: (principal, invitationId: string, input) =>
    Effect.gen(function* () {
      const invitationStore = yield* OrganizationInvitationStorePort
      const organizationStore = yield* OrganizationStorePort

      const existing = yield* invitationStore.getById(invitationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch invitation')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Invitation not found')),
          onSome: Effect.succeed
        }))
      )

      const role = yield* organizationStore.getMemberRole(existing.organizationId, principal.userId).pipe(
        Effect.mapError((cause) => unauthorized('Not allowed to update invitation', cause))
      )

      const roleValue = Option.getOrNull(role)
      if (!roleValue || !canManageInvitation(roleValue)) {
        return yield* Effect.fail(unauthorized('Only admins and owners can update invitations'))
      }

      if (!isValidInvitationRoleUpdate(input.role) || !isValidInvitationStatusUpdate(input.status)) {
        return yield* Effect.fail(badRequest('Invalid invitation update payload'))
      }

      if (input.role === undefined && input.status === undefined) {
        return yield* Effect.fail(badRequest('Invitation update payload is empty'))
      }

      if (input.status === 'accepted') {
        return yield* Effect.fail(badRequest('Invitation status cannot be set to accepted manually'))
      }

      if (input.status === 'revoked' && existing.status === 'revoked') {
        return yield* Effect.fail(conflict('Invitation is already revoked'))
      }

      const updated = yield* invitationStore.updateById({
        id: invitationId,
        role: input.role,
        status: input.status,
        ...(input.status === 'revoked' ? { revokedByUserId: principal.userId } : {})
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to update invitation')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Invitation not found')),
          onSome: Effect.succeed
        }))
      )

      return updated
    }),

  removeInvitationById: (principal, invitationId: string) =>
    Effect.gen(function* () {
      const invitationStore = yield* OrganizationInvitationStorePort
      const organizationStore = yield* OrganizationStorePort

      const existing = yield* invitationStore.getById(invitationId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch invitation')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Invitation not found')),
          onSome: Effect.succeed
        }))
      )

      if (existing.status === 'revoked') {
        // Idempotent: already revoked, just confirm deletion
        return { deleted: true as const }
      }

      const role = yield* organizationStore.getMemberRole(existing.organizationId, principal.userId).pipe(
        Effect.mapError((cause) => unauthorized('Not allowed to revoke invitation', cause))
      )

      const roleValue = Option.getOrNull(role)
      if (!roleValue || !canManageInvitation(roleValue)) {
        return yield* Effect.fail(unauthorized('Only admins and owners can revoke invitations'))
      }

      yield* invitationStore.updateById({
        id: invitationId,
        status: 'revoked',
        revokedByUserId: principal.userId
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to revoke invitation')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Invitation not found')),
          onSome: Effect.succeed
        }))
      )

      return { deleted: true as const }
    }),

  createInvitation: (principal, input) =>
    Effect.gen(function* () {
      const organizationStore = yield* OrganizationStorePort
      const invitationStore = yield* OrganizationInvitationStorePort
      const usersPort = yield* OrganizationUsersPort
      const emailPort = yield* InvitationEmailPort

      if (!isValidInvitationEmail(input.email)) {
        return yield* Effect.fail(badRequest('Invalid invitation payload'))
      }

      const email = normalizeInvitationEmail(input.email)

      const inviterRole = yield* organizationStore.getMemberRole(input.organizationId, principal.userId).pipe(
        Effect.mapError((cause) => unauthorized('Not allowed to invite', cause))
      )

      if (Option.isNone(inviterRole)) {
        return yield* Effect.fail(unauthorized('Not allowed to invite'))
      }

      if (!canCreateInvitation(inviterRole.value)) {
        return yield* Effect.fail(unauthorized('Only admins and owners can create invitations'))
      }

      if (input.membershipType === 'client' && !input.teamId) {
        return yield* Effect.fail(badRequest('Client collaborator invitations must target a workspace'))
      }

      if (input.teamId) {
        const teamBelongsToOrganization = yield* invitationStore.teamBelongsToOrganization(input.teamId, input.organizationId).pipe(
          Effect.mapError(toCoreInternal('Failed to validate invitation workspace'))
        )

        if (!teamBelongsToOrganization) {
          return yield* Effect.fail(badRequest('Workspace does not belong to organization'))
        }
      }

      const existingUser = yield* usersPort.findByEmail(email).pipe(
        Effect.mapError(toCoreInternal('Failed to look up invited user'))
      )

      const alreadyMember = Option.isSome(existingUser)
        ? yield* organizationStore.isMember(input.organizationId, existingUser.value.id).pipe(
          Effect.mapError(toCoreInternal('Failed to validate existing membership'))
        )
        : false

      if (alreadyMember) {
        return yield* Effect.fail(conflict('User is already an organization member'))
      }

      const pendingInvitationExists = yield* invitationStore.pendingInvitationExists({
        organizationId: input.organizationId,
        email,
        ...(input.teamId ? { teamId: input.teamId } : {})
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to validate pending invitation uniqueness'))
      )

      if (pendingInvitationExists) {
        return yield* Effect.fail(conflict(
          input.teamId
            ? 'A pending invitation already exists for this email and workspace'
            : 'A pending organization invitation already exists for this email'
        ))
      }

      // The DB enforces one pending org-wide invitation per org/email and one
      // pending scoped invitation per org/email/workspace. Org-wide and scoped
      // invites may coexist because they grant different access surfaces.
      const created = yield* invitationStore.create({
        organizationId: input.organizationId,
        inviteeUserId: Option.isSome(existingUser) ? existingUser.value.id : null,
        email,
        role: input.role,
        invitedByUserId: principal.userId,
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.membershipType ? { membershipType: input.membershipType } : {})
      }).pipe(
        Effect.mapError((cause) => mapCreateInvitationError(cause, input.teamId)),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(badRequest('Invitation creation failed')),
          onSome: Effect.succeed
        }))
      )

      const organization = yield* organizationStore.getById(input.organizationId).pipe(
        Effect.mapError(toCoreInternal('Failed to look up organization for email'))
      )

      const inviter = yield* usersPort.findById(principal.userId).pipe(
        Effect.mapError(toCoreInternal('Failed to look up inviter for email'))
      )

      yield* emailPort.sendInvitationEmail({
        recipientEmail: email,
        recipientName: Option.match(existingUser, { onNone: () => email, onSome: (u) => u.name }),
        organizationName: Option.match(organization, { onNone: () => 'your organization', onSome: (o) => o.name }),
        inviterName: Option.match(inviter, { onNone: () => 'A teammate', onSome: (u) => u.name }),
        role: input.role,
        token: created.token
      }).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      return created
    }),

  acceptInvitation: (principal, token: string) =>
    Effect.gen(function* () {
      const invitationStore = yield* OrganizationInvitationStorePort

      if (!token) {
        return yield* Effect.fail(badRequest('Missing invitation token'))
      }

      // The store atomically enforces either a bound invitee user id or an
      // email-only invite matching the authenticated principal email.
      const accepted = yield* invitationStore.acceptByToken(
        token,
        principal.userId,
        normalizeInvitationEmail(principal.email)
      ).pipe(
        Effect.mapError(toCoreInternal('Failed to accept invitation')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Invitation not found or expired')),
          onSome: Effect.succeed
        }))
      )

      if (accepted.inviteeUserId !== principal.userId) {
        return yield* Effect.fail(unauthorized('Invitation does not belong to this user'))
      }

      return { accepted: true as const }
    })
}
