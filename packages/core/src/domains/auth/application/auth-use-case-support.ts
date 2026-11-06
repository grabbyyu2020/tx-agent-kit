import { Effect, Option } from 'effect'
import { internalError, type CoreError } from '../../../errors.js'
import {
  toAuthPrincipal,
  toAuthUser,
  type AuthPrincipal,
  type AuthSession,
  type AuthUserRecord
} from '../domain/auth-domain.js'
import {
  AuthLoginAuditPort,
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  AuthOrganizationMembershipPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

export interface AuthRequestContext {
  ipAddress?: string
  userAgent?: string
}

export const isEmailUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return code === 'DB_USER_EMAIL_UNIQUE_VIOLATION'
}

export const isAuthLoginIdentityUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return code === 'DB_AUTH_LOGIN_IDENTITY_UNIQUE_VIOLATION'
}

export const recordAuditEvent = (
  input: {
    userId: string | null
    eventType: 'login_success' | 'login_failure' | 'password_reset_requested' | 'password_changed' | 'oauth_linked' | 'oauth_unlinked' | 'session_refreshed' | 'session_revoked' | 'account_deleted'
    status: 'success' | 'failure'
    identifier: string | null
    ipAddress: string | null
    metadata?: Record<string, unknown>
  }
): Effect.Effect<void, never, AuthLoginAuditPort> =>
  Effect.gen(function* () {
    const auditPort = yield* AuthLoginAuditPort

    yield* auditPort.record({
      userId: input.userId,
      eventType: input.eventType,
      status: input.status,
      identifier: input.identifier,
      ipAddress: input.ipAddress,
      metadata: input.metadata ?? {}
    }).pipe(
      Effect.catchAll((_cause) => Effect.void)
    )
  })

export const buildSession = (
  user: AuthUserRecord,
  provider: 'password' | 'google',
  context: AuthRequestContext
): Effect.Effect<
  AuthSession,
  CoreError,
  AuthLoginSessionPort | AuthLoginRefreshTokenPort | SessionTokenPort | AuthOrganizationMembershipPort
> =>
  Effect.gen(function* () {
    const loginSessionPort = yield* AuthLoginSessionPort
    const refreshTokenPort = yield* AuthLoginRefreshTokenPort
    const sessionTokenPort = yield* SessionTokenPort

    const createdSession = yield* loginSessionPort
      .create({
        userId: user.id,
        provider,
        createdIp: context.ipAddress ?? null,
        createdUserAgent: context.userAgent ?? null
      })
      .pipe(
        Effect.mapError(toCoreInternal('Failed to create login session')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(internalError('Failed to create login session')),
          onSome: Effect.succeed
        }))
      )

    const token = yield* sessionTokenPort.sign({
      sub: user.id,
      email: user.email,
      pwd: user.passwordChangedAt.getTime(),
      sid: createdSession.sessionId
    }).pipe(Effect.mapError(toCoreInternal('Failed to create access token')))

    const refresh = yield* refreshTokenPort
      .issueForSession(createdSession.sessionId)
      .pipe(Effect.mapError(toCoreInternal('Failed to issue refresh token')))

    const principal = yield* buildPrincipalForUser(user, createdSession.sessionId)

    return {
      token,
      refreshToken: refresh.refreshToken,
      user: toAuthUser(user),
      principal
    }
  })

export const buildPrincipalForUser = (
  user: AuthUserRecord,
  sessionId: string
): Effect.Effect<AuthPrincipal, CoreError, AuthOrganizationMembershipPort> =>
  Effect.gen(function* () {
    const membershipPort = yield* AuthOrganizationMembershipPort
    const primaryMembershipOpt = yield* membershipPort.getPrimaryMembershipForUser(user.id).pipe(
      Effect.mapError(toCoreInternal('Failed to load authenticated principal'))
    )
    const primaryMembership = Option.getOrUndefined(primaryMembershipOpt)

    return toAuthPrincipal({
      sub: user.id,
      email: user.email,
      sid: sessionId,
      organizationId: primaryMembership?.organizationId,
      role: primaryMembership?.role,
      permissions: primaryMembership?.permissions ?? []
    })
  })

export const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)
