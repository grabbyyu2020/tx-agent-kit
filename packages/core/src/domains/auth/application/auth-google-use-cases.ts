import { randomBytes } from 'node:crypto'
import { type Context, Effect, Option } from 'effect'
import { badRequest, conflict, unauthorized } from '../../../errors.js'
import { normalizeEmail, type AuthUserRecord } from '../domain/auth-domain.js'
import {
  AuthLoginIdentityPort,
  AuthUsersPort,
  GoogleOidcPort,
  PasswordHasherPort
} from '../ports/auth-ports.js'
import type { AuthService } from './auth-service.js'
import {
  buildSession,
  isAuthLoginIdentityUniqueViolation,
  isEmailUniqueViolation,
  recordAuditEvent,
  toCoreInternal
} from './auth-use-case-support.js'

type AuthServiceShape = Context.Tag.Service<typeof AuthService>

export const authGoogleUseCases: Pick<
  AuthServiceShape,
  | 'startGoogleAuth'
  | 'completeGoogleAuth'
> = {
  startGoogleAuth: (input) =>
    Effect.gen(function* () {
      const googleOidcPort = yield* GoogleOidcPort

      return yield* googleOidcPort
        .startAuthorization({
          ipAddress: input.ipAddress ?? null,
          statePrefix: input.statePrefix
        })
        .pipe(Effect.mapError(toCoreInternal('Failed to start Google authorization')))
    }),

  completeGoogleAuth: (input) =>
    Effect.gen(function* () {
      const usersPort = yield* AuthUsersPort
      const passwordHasher = yield* PasswordHasherPort
      const googleOidcPort = yield* GoogleOidcPort
      const identityPort = yield* AuthLoginIdentityPort

      const identity = yield* googleOidcPort.completeAuthorization({
        code: input.code,
        state: input.state,
        iss: input.iss
      }).pipe(Effect.mapError((cause) => unauthorized('Invalid Google authorization response', cause)))

      const normalizedEmail = normalizeEmail(identity.email)

      if (!identity.emailVerified) {
        yield* recordAuditEvent({
          userId: null,
          eventType: 'login_failure',
          status: 'failure',
          identifier: normalizedEmail,
          ipAddress: input.ipAddress ?? null,
          metadata: { reason: 'google_email_not_verified' }
        })
        return yield* Effect.fail(unauthorized('Google account email must be verified'))
      }

      const linkedIdentityOpt = yield* identityPort.findByProviderSubject({
        provider: 'google',
        providerSubject: identity.providerSubject
      }).pipe(Effect.mapError(toCoreInternal('Failed to read Google identity link')))

      let userOpt: Option.Option<AuthUserRecord> = Option.isSome(linkedIdentityOpt)
        ? yield* usersPort.findById(linkedIdentityOpt.value.userId).pipe(
            Effect.mapError(toCoreInternal('Failed to read linked user'))
          )
        : Option.none()

      let didLinkIdentity = false

      if (Option.isNone(userOpt)) {
        const existingUserOpt = yield* usersPort.findByEmail(normalizedEmail).pipe(
          Effect.mapError(toCoreInternal('Failed to read existing user'))
        )

        if (Option.isSome(existingUserOpt)) {
          userOpt = existingUserOpt
        } else {
          const syntheticPassword = randomBytes(64).toString('base64url')
          const syntheticPasswordHash = yield* passwordHasher.hash(syntheticPassword).pipe(
            Effect.mapError(toCoreInternal('Failed to generate Google account credentials'))
          )

          userOpt = yield* usersPort.create({
            email: normalizedEmail,
            passwordHash: syntheticPasswordHash,
            name: identity.name.trim().length > 0 ? identity.name : normalizedEmail
          }).pipe(
            Effect.catchAll((error) =>
              isEmailUniqueViolation(error)
                ? Effect.fail(conflict('Email is already in use'))
                : Effect.fail(badRequest('Google login failed'))
            )
          )
        }

        if (Option.isNone(userOpt)) {
          return yield* Effect.fail(badRequest('Google login failed'))
        }

        const user = userOpt.value

        const existingProviderLinkOpt = yield* identityPort.findByUserProvider({
          userId: user.id,
          provider: 'google'
        }).pipe(Effect.mapError(toCoreInternal('Failed to read existing Google link')))

        if (Option.isNone(existingProviderLinkOpt)) {
          const linkResultOpt = yield* identityPort.linkIdentity({
            userId: user.id,
            provider: 'google',
            providerSubject: identity.providerSubject,
            email: normalizedEmail,
            emailVerified: identity.emailVerified
          }).pipe(
            Effect.catchAll((error) =>
              isAuthLoginIdentityUniqueViolation(error)
                ? Effect.succeed(Option.none())
                : Effect.fail(error)
            ),
            Effect.mapError(toCoreInternal('Failed to link Google identity'))
          )
          didLinkIdentity = Option.isSome(linkResultOpt)
        }
      }

      if (Option.isNone(userOpt)) {
        return yield* Effect.fail(badRequest('Google login failed — user record not found'))
      }
      const user = userOpt.value

      const session = yield* buildSession(user, 'google', {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      })

      if (didLinkIdentity) {
        yield* recordAuditEvent({
          userId: user.id,
          eventType: 'oauth_linked',
          status: 'success',
          identifier: normalizedEmail,
          ipAddress: input.ipAddress ?? null,
          metadata: { provider: 'google' }
        })
      }

      yield* recordAuditEvent({
        userId: user.id,
        eventType: 'login_success',
        status: 'success',
        identifier: normalizedEmail,
        ipAddress: input.ipAddress ?? null,
        metadata: { provider: 'google', flow: 'oidc' }
      })

      return session
    })
}
