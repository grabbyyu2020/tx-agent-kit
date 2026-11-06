import { Context, Effect, Layer } from 'effect'
import type { CoreError } from '../../../errors.js'
import type {
  CompleteGoogleAuthCommand,
  ForgotPasswordCommand,
  GoogleAuthStartResult,
  RefreshSessionCommand,
  ResetPasswordCommand,
  StartGoogleAuthCommand,
  AuthPrincipal,
  AuthSession,
  SignInCommand,
  SignUpCommand
} from '../domain/auth-domain.js'
import type {
  AuthLoginAuditPort,
  AuthLoginIdentityPort,
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  AuthOrganizationMembershipPort,
  AuthOrganizationOwnershipPort,
  AuthUsersPort,
  GoogleOidcPort,
  PasswordResetEmailPort,
  PasswordResetTokenPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'
import { authAccountUseCases } from './auth-account-use-cases.js'
import { authGoogleUseCases } from './auth-google-use-cases.js'
import { makeAuthPasswordResetUseCases } from './auth-password-reset-use-cases.js'
import { createPrincipalResolutionCache } from './auth-principal-cache.js'
import { makeAuthSessionUseCases } from './auth-session-use-cases.js'
import type { AuthRequestContext } from './auth-use-case-support.js'

export class AuthService extends Context.Tag('AuthService')<
  AuthService,
  {
    signUp: (
      input: SignUpCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | PasswordHasherPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthOrganizationMembershipPort | AuthLoginAuditPort
    >
    signIn: (
      input: SignInCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | PasswordHasherPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthOrganizationMembershipPort | AuthLoginAuditPort
    >
    refreshSession: (
      input: RefreshSessionCommand
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthOrganizationMembershipPort | AuthLoginAuditPort
    >
    signOutSession: (
      principal: AuthPrincipal
    ) => Effect.Effect<
      { revoked: true },
      CoreError,
      AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    signOutAllSessions: (
      principal: { userId: string }
    ) => Effect.Effect<
      { revokedSessions: number },
      CoreError,
      AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    startGoogleAuth: (
      input: StartGoogleAuthCommand
    ) => Effect.Effect<GoogleAuthStartResult, CoreError, GoogleOidcPort>
    completeGoogleAuth: (
      input: CompleteGoogleAuthCommand
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | PasswordHasherPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthOrganizationMembershipPort | AuthLoginIdentityPort | GoogleOidcPort | AuthLoginAuditPort
    >
    requestPasswordReset: (
      input: ForgotPasswordCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      { accepted: true },
      CoreError,
      AuthUsersPort | PasswordResetTokenPort | PasswordResetEmailPort | AuthLoginAuditPort
    >
    resetPassword: (
      input: ResetPasswordCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      { reset: true },
      CoreError,
      AuthUsersPort | PasswordHasherPort | PasswordResetTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    getPrincipalFromToken: (
      token: string
    ) => Effect.Effect<AuthPrincipal, CoreError, AuthUsersPort | SessionTokenPort | AuthOrganizationMembershipPort | AuthLoginSessionPort>
    deleteUser: (
      principal: { userId: string }
    ) => Effect.Effect<{ deleted: true }, CoreError, AuthUsersPort | AuthOrganizationOwnershipPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort>
  }
>() {}

// Use cases live in sibling modules grouped by responsibility; the key
// order below matches the original single-literal implementation. The
// principal cache is still created once per layer build and shared by the
// groups that invalidate or populate it.
export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.sync(() => {
    const principalCache = createPrincipalResolutionCache()

    return {
      ...makeAuthSessionUseCases(principalCache),
      ...authGoogleUseCases,
      ...makeAuthPasswordResetUseCases(principalCache),
      ...authAccountUseCases
    }
  })
)
