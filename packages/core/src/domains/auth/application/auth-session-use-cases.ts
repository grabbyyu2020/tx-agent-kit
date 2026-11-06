import { type Context, Effect, Option } from 'effect'
import { badRequest, conflict, unauthorized } from '../../../errors.js'
import {
  isValidDisplayName,
  isValidEmail,
  normalizeEmail,
  toAuthUser
} from '../domain/auth-domain.js'
import {
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  AuthUsersPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'
import type { PrincipalResolutionCache } from './auth-principal-cache.js'
import type { AuthService } from './auth-service.js'
import {
  buildPrincipalForUser,
  buildSession,
  isEmailUniqueViolation,
  recordAuditEvent,
  toCoreInternal
} from './auth-use-case-support.js'

type AuthServiceShape = Context.Tag.Service<typeof AuthService>

export const makeAuthSessionUseCases = (
  principalCache: PrincipalResolutionCache
): Pick<
  AuthServiceShape,
  | 'signUp'
  | 'signIn'
  | 'refreshSession'
  | 'signOutSession'
  | 'signOutAllSessions'
> => ({
  signUp: (input, context = {}) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const passwordHasher = yield* PasswordHasherPort

      if (!isValidEmail(input.email) || !isValidDisplayName(input.name) || input.password.length < 8) {
        yield* recordAuditEvent({
          userId: null,
          eventType: 'login_failure',
          status: 'failure',
          identifier: normalizeEmail(input.email),
          ipAddress: context.ipAddress ?? null,
          metadata: { reason: 'invalid_sign_up_payload' }
        })
        return yield* Effect.fail(badRequest('Invalid sign-up payload'))
      }

      const email = normalizeEmail(input.email)
      const name = input.name.trim()

      const existingOpt = yield* usersPort.findByEmail(email).pipe(
        Effect.mapError((cause) => badRequest('Sign-up failed', cause))
      )

      if (Option.isSome(existingOpt)) {
        yield* recordAuditEvent({
          userId: existingOpt.value.id,
          eventType: 'login_failure',
          status: 'failure',
          identifier: email,
          ipAddress: context.ipAddress ?? null,
          metadata: { reason: 'email_already_used' }
        })
        return yield* Effect.fail(conflict('Email is already in use'))
      }

      const passwordHash = yield* passwordHasher.hash(input.password).pipe(
        Effect.mapError((cause) => badRequest('Could not hash password', cause))
      )

      const created = yield* usersPort.create({
        email,
        passwordHash,
        name
      }).pipe(
        Effect.catchAll((error) =>
          isEmailUniqueViolation(error)
            ? Effect.fail(conflict('Email is already in use'))
            : Effect.fail(badRequest('Sign-up failed'))
        ),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(badRequest('User creation failed')),
          onSome: Effect.succeed
        }))
      )

      const session = yield* buildSession(created, 'password', context)
      if (session.principal) {
        principalCache.set(session.token, session.principal)
      }

      yield* recordAuditEvent({
        userId: created.id,
        eventType: 'login_success',
        status: 'success',
        identifier: email,
        ipAddress: context.ipAddress ?? null,
        metadata: { provider: 'password', flow: 'sign_up' }
      })

      return session
    }),

  signIn: (input, context = {}) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const passwordHasher = yield* PasswordHasherPort

      if (!isValidEmail(input.email)) {
        yield* recordAuditEvent({
          userId: null,
          eventType: 'login_failure',
          status: 'failure',
          identifier: normalizeEmail(input.email),
          ipAddress: context.ipAddress ?? null,
          metadata: { reason: 'invalid_sign_in_payload' }
        })
        return yield* Effect.fail(unauthorized('Invalid credentials'))
      }

      const email = normalizeEmail(input.email)

      const user = yield* usersPort.findByEmail(email).pipe(
        Effect.mapError((cause) => unauthorized('Invalid credentials', cause)),
        Effect.flatMap(Option.match({
          onNone: () => {
            return recordAuditEvent({
              userId: null,
              eventType: 'login_failure',
              status: 'failure',
              identifier: email,
              ipAddress: context.ipAddress ?? null,
              metadata: { reason: 'missing_user' }
            }).pipe(Effect.flatMap(() => Effect.fail(unauthorized('Invalid credentials'))))
          },
          onSome: Effect.succeed
        }))
      )

      const ok = yield* passwordHasher.verify(input.password, user.passwordHash).pipe(
        Effect.mapError((cause) => unauthorized('Invalid credentials', cause))
      )

      if (!ok) {
        yield* recordAuditEvent({
          userId: user.id,
          eventType: 'login_failure',
          status: 'failure',
          identifier: email,
          ipAddress: context.ipAddress ?? null,
          metadata: { reason: 'invalid_password' }
        })
        return yield* Effect.fail(unauthorized('Invalid credentials'))
      }

      const session = yield* buildSession(user, 'password', context)
      if (session.principal) {
        principalCache.set(session.token, session.principal)
      }

      yield* recordAuditEvent({
        userId: user.id,
        eventType: 'login_success',
        status: 'success',
        identifier: email,
        ipAddress: context.ipAddress ?? null,
        metadata: { provider: 'password', flow: 'sign_in' }
      })

      return session
    }),

  refreshSession: (input) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const refreshTokenPort = yield* AuthLoginRefreshTokenPort
      const sessionTokenPort = yield* SessionTokenPort
      const loginSessionPort = yield* AuthLoginSessionPort

      if (input.refreshToken.trim().length < 1) {
        return yield* Effect.fail(unauthorized('Invalid refresh token'))
      }

      const rotated = yield* refreshTokenPort.rotate(input.refreshToken).pipe(
        Effect.mapError((cause) => unauthorized('Invalid refresh token', cause)),
        Effect.flatMap(Option.match({
          onNone: () => {
            return recordAuditEvent({
              userId: null,
              eventType: 'session_refreshed',
              status: 'failure',
              identifier: null,
              ipAddress: null,
              metadata: { reason: 'refresh_token_rejected' }
            }).pipe(Effect.flatMap(() => Effect.fail(unauthorized('Invalid refresh token'))))
          },
          onSome: Effect.succeed
        }))
      )

      const activeSession = yield* loginSessionPort.findActiveById(rotated.sessionId).pipe(
        Effect.tapError((_cause) =>
          refreshTokenPort.revokeForSession(rotated.sessionId).pipe(Effect.catchAll((_cause2) => Effect.void))
        ),
        Effect.mapError((cause) => unauthorized('Invalid refresh session', cause)),
        Effect.flatMap(Option.match({
          onNone: () => {
            return refreshTokenPort.revokeForSession(rotated.sessionId).pipe(
              Effect.catchAll((_cause) => Effect.void),
              Effect.flatMap(() => recordAuditEvent({
                userId: null,
                eventType: 'session_refreshed',
                status: 'failure',
                identifier: null,
                ipAddress: null,
                metadata: { reason: 'session_inactive', sessionId: rotated.sessionId }
              })),
              Effect.flatMap(() => Effect.fail(unauthorized('Invalid refresh session')))
            )
          },
          onSome: Effect.succeed
        }))
      )

      const user = yield* usersPort.findById(activeSession.userId).pipe(
        Effect.mapError((cause) => unauthorized('Invalid refresh session', cause)),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(unauthorized('Invalid refresh session')),
          onSome: Effect.succeed
        }))
      )

      yield* loginSessionPort.touchById(activeSession.sessionId).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      const token = yield* sessionTokenPort.sign({
        sub: user.id,
        email: user.email,
        pwd: user.passwordChangedAt.getTime(),
        sid: activeSession.sessionId
      }).pipe(Effect.mapError(toCoreInternal('Failed to issue access token')))

      yield* recordAuditEvent({
        userId: user.id,
        eventType: 'session_refreshed',
        status: 'success',
        identifier: user.email,
        ipAddress: null,
        metadata: { sessionId: activeSession.sessionId }
      })

      const principal = yield* buildPrincipalForUser(user, activeSession.sessionId)
      const session = {
        token,
        refreshToken: rotated.refreshToken,
        user: toAuthUser(user),
        principal
      }
      principalCache.set(token, principal)
      return session
    }),

  signOutSession: (principal) =>
    Effect.gen(function* () {
      const loginSessionPort = yield* AuthLoginSessionPort
      const refreshTokenPort = yield* AuthLoginRefreshTokenPort

      if (!principal.sessionId) {
        return yield* Effect.fail(unauthorized('Invalid token'))
      }

      yield* refreshTokenPort.revokeForSession(principal.sessionId).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      yield* loginSessionPort.revokeById(principal.sessionId).pipe(
        Effect.mapError(toCoreInternal('Failed to revoke session'))
      )
      principalCache.invalidateSession(principal.sessionId)

      yield* recordAuditEvent({
        userId: principal.userId,
        eventType: 'session_revoked',
        status: 'success',
        identifier: principal.email,
        ipAddress: null,
        metadata: { scope: 'single_session', sessionId: principal.sessionId }
      })

      return { revoked: true as const }
    }),

  signOutAllSessions: (principal) =>
    Effect.gen(function* () {
      const loginSessionPort = yield* AuthLoginSessionPort
      const refreshTokenPort = yield* AuthLoginRefreshTokenPort

      yield* refreshTokenPort.revokeAllForUser(principal.userId).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      // Use catchAll (non-fatal) — consistent with resetPassword and deleteUser.
      // A transient DB hiccup should not prevent a user from signing out.
      const revokedSessions = yield* loginSessionPort.revokeAllForUser(principal.userId).pipe(
        Effect.catchAll((_cause) => Effect.succeed(0))
      )
      principalCache.invalidateUser(principal.userId)

      yield* recordAuditEvent({
        userId: principal.userId,
        eventType: 'session_revoked',
        status: 'success',
        identifier: null,
        ipAddress: null,
        metadata: { scope: 'all_sessions', revokedSessions }
      })

      return { revokedSessions }
    })
})
