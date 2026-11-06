import { type Context, Effect, Option } from 'effect'
import { badRequest, notFound } from '../../../errors.js'
import { isValidEmail, normalizeEmail } from '../domain/auth-domain.js'
import {
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  AuthUsersPort,
  PasswordHasherPort,
  PasswordResetEmailPort,
  PasswordResetTokenPort
} from '../ports/auth-ports.js'
import type { PrincipalResolutionCache } from './auth-principal-cache.js'
import type { AuthService } from './auth-service.js'
import { recordAuditEvent, toCoreInternal } from './auth-use-case-support.js'

type AuthServiceShape = Context.Tag.Service<typeof AuthService>

export const makeAuthPasswordResetUseCases = (
  principalCache: PrincipalResolutionCache
): Pick<
  AuthServiceShape,
  | 'requestPasswordReset'
  | 'resetPassword'
> => ({
  requestPasswordReset: (input, context = {}) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const passwordResetTokenPort = yield* PasswordResetTokenPort
      const passwordResetEmailPort = yield* PasswordResetEmailPort

      if (!isValidEmail(input.email)) {
        yield* recordAuditEvent({
          userId: null,
          eventType: 'password_reset_requested',
          status: 'failure',
          identifier: normalizeEmail(input.email),
          ipAddress: context.ipAddress ?? null,
          metadata: { reason: 'invalid_forgot_password_payload' }
        })
        return yield* Effect.fail(badRequest('Invalid forgot-password payload'))
      }

      const email = normalizeEmail(input.email)
      const userOpt = yield* usersPort.findByEmail(email).pipe(
        Effect.mapError(toCoreInternal('Failed to process forgot-password request'))
      )

      if (Option.isNone(userOpt)) {
        yield* recordAuditEvent({
          userId: null,
          eventType: 'password_reset_requested',
          status: 'success',
          identifier: email,
          ipAddress: context.ipAddress ?? null,
          metadata: { accountFound: false }
        })
        return { accepted: true as const }
      }

      const user = userOpt.value

      yield* passwordResetTokenPort.revokeTokensForUser(user.id).pipe(
        Effect.mapError(toCoreInternal('Failed to process forgot-password request'))
      )

      const token = yield* passwordResetTokenPort.createToken(user.id).pipe(
        Effect.mapError(toCoreInternal('Failed to process forgot-password request'))
      )

      // Best-effort: a failed email send (provider outage, rejected
      // recipient, transient 5xx) MUST NOT change the response. Otherwise an
      // existing account whose email fails returns an error while a missing
      // account returns 202 — an account-enumeration oracle — and any
      // email-provider outage would fail every real user's reset. The token is
      // already persisted, so the user can retry; we always return the generic 202.
      yield* passwordResetEmailPort.sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        token
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logError('Failed to send password reset email; returning generic response', { cause })
        ),
        Effect.catchAll(() => Effect.void)
      )

      yield* recordAuditEvent({
        userId: user.id,
        eventType: 'password_reset_requested',
        status: 'success',
        identifier: email,
        ipAddress: context.ipAddress ?? null,
        metadata: { accountFound: true }
      })

      return { accepted: true as const }
    }),

  resetPassword: (input, context = {}) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const passwordHasher = yield* PasswordHasherPort
      const passwordResetTokenPort = yield* PasswordResetTokenPort

      if (input.token.trim().length < 1 || input.password.length < 8) {
        return yield* Effect.fail(badRequest('Invalid reset-password payload'))
      }

      const tokenPrincipal = yield* passwordResetTokenPort.consumeToken(input.token).pipe(
        Effect.mapError((cause) => badRequest('Invalid or expired password reset token', cause)),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(badRequest('Invalid or expired password reset token')),
          onSome: Effect.succeed
        }))
      )

      const passwordHash = yield* passwordHasher.hash(input.password).pipe(
        Effect.mapError((cause) => badRequest('Could not hash password', cause))
      )

      const updatedUser = yield* usersPort
        .updatePasswordHash(tokenPrincipal.userId, passwordHash)
        .pipe(
          Effect.mapError(toCoreInternal('Failed to reset password')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('User not found')),
            onSome: Effect.succeed
          }))
        )

      yield* passwordResetTokenPort.revokeTokensForUser(tokenPrincipal.userId).pipe(
        Effect.catchAll(() => Effect.void)
      )

      const loginSessionPort = yield* AuthLoginSessionPort
      const refreshTokenPort = yield* AuthLoginRefreshTokenPort

      yield* refreshTokenPort.revokeAllForUser(tokenPrincipal.userId).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      yield* loginSessionPort.revokeAllForUser(tokenPrincipal.userId).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )
      principalCache.invalidateUser(tokenPrincipal.userId)

      yield* recordAuditEvent({
        userId: tokenPrincipal.userId,
        eventType: 'password_changed',
        status: 'success',
        identifier: updatedUser.email,
        ipAddress: context.ipAddress ?? null,
        metadata: {}
      })

      return { reset: true as const }
    })
})
