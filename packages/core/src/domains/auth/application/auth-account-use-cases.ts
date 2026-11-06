import { type Context, Effect, Option } from 'effect'
import { conflict, notFound, unauthorized } from '../../../errors.js'
import { toAuthPrincipal } from '../domain/auth-domain.js'
import {
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  AuthOrganizationMembershipPort,
  AuthOrganizationOwnershipPort,
  AuthUsersPort,
  SessionTokenPort
} from '../ports/auth-ports.js'
import type { AuthService } from './auth-service.js'
import { recordAuditEvent, toCoreInternal } from './auth-use-case-support.js'

type AuthServiceShape = Context.Tag.Service<typeof AuthService>

export const authAccountUseCases: Pick<
  AuthServiceShape,
  | 'getPrincipalFromToken'
  | 'deleteUser'
> = {
  getPrincipalFromToken: (token: string) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const sessionTokenPort = yield* SessionTokenPort
      const membershipPort = yield* AuthOrganizationMembershipPort
      const loginSessionPort = yield* AuthLoginSessionPort

      const payload = yield* sessionTokenPort.verify(token).pipe(
        Effect.mapError((cause) => unauthorized('Invalid token', cause))
      )

      if (typeof payload.pwd !== 'number' || typeof payload.sid !== 'string') {
        return yield* Effect.fail(unauthorized('Invalid token'))
      }

      const activeSession = yield* loginSessionPort.findActiveById(payload.sid).pipe(
        Effect.mapError((cause) => unauthorized('Invalid token', cause)),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(unauthorized('Invalid token')),
          onSome: Effect.succeed
        }))
      )

      if (activeSession.userId !== payload.sub) {
        return yield* Effect.fail(unauthorized('Invalid token'))
      }

      const user = yield* usersPort.findById(payload.sub).pipe(
        Effect.mapError((cause) => unauthorized('Invalid token', cause)),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(unauthorized('Invalid token')),
          onSome: Effect.succeed
        }))
      )

      if (payload.pwd < user.passwordChangedAt.getTime()) {
        return yield* Effect.fail(unauthorized('Invalid token'))
      }

      yield* loginSessionPort.touchById(payload.sid).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      const primaryMembershipOpt = yield* membershipPort.getPrimaryMembershipForUser(user.id).pipe(
        Effect.mapError((cause) => unauthorized('Invalid token', cause))
      )

      const primaryMembership = Option.getOrUndefined(primaryMembershipOpt)

      return toAuthPrincipal({
        sub: user.id,
        email: user.email,
        sid: payload.sid,
        organizationId: primaryMembership?.organizationId,
        role: primaryMembership?.role,
        permissions: primaryMembership?.permissions ?? []
      })
    }),

  deleteUser: (principal) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const organizationOwnershipPort = yield* AuthOrganizationOwnershipPort
      const loginSessionPort = yield* AuthLoginSessionPort
      const refreshTokenPort = yield* AuthLoginRefreshTokenPort

      const existing = yield* usersPort.findById(principal.userId).pipe(
        Effect.mapError(toCoreInternal('Failed to read user')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('User not found')),
          onSome: Effect.succeed
        }))
      )

      const ownedOrganizationCount = yield* organizationOwnershipPort.countOwnedByUser(principal.userId).pipe(
        Effect.mapError(toCoreInternal('Failed to validate organization ownership'))
      )

      if (ownedOrganizationCount > 0) {
        return yield* Effect.fail(conflict('Cannot delete account while owning organizations. Transfer ownership first.'))
      }

      yield* refreshTokenPort.revokeAllForUser(principal.userId).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      yield* loginSessionPort.revokeAllForUser(principal.userId).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      yield* usersPort.deleteById(principal.userId).pipe(
        Effect.mapError(toCoreInternal('Failed to delete user')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('User not found')),
          onSome: Effect.succeed
        }))
      )

      yield* recordAuditEvent({
        userId: principal.userId,
        eventType: 'account_deleted',
        status: 'success',
        identifier: existing.email,
        ipAddress: null,
        metadata: {}
      })

      return { deleted: true as const }
    })
}
