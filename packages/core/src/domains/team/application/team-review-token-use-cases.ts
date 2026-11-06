import { type Context, Effect, Option } from 'effect'
import { badRequest, notFound } from '../../../errors.js'
import { ContentReviewTokenStorePort, TeamStorePort } from '../ports/team-ports.js'
import type { TeamService } from './team-service.js'
import {
  requireOrgAdmin,
  requireOrgMembership,
  toCoreInternal
} from './team-use-case-support.js'

type TeamServiceShape = Context.Tag.Service<typeof TeamService>

export const teamReviewTokenUseCases: Pick<
  TeamServiceShape,
  | 'createReviewToken'
  | 'listReviewTokens'
  | 'revokeReviewToken'
  | 'validateReviewToken'
> = {
  createReviewToken: (principal, teamId, input) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort
      const tokenStore = yield* ContentReviewTokenStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      const MAX_REVIEW_TOKEN_EXPIRY_DAYS = 365
      const clampedExpiry = Math.min(input.expiresInDays ?? 30, MAX_REVIEW_TOKEN_EXPIRY_DAYS)
      const expiresAt = new Date(Date.now() + clampedExpiry * 24 * 60 * 60 * 1000)

      const created = yield* tokenStore.create({
        teamId,
        expiresAt,
        permissions: input.permissions,
        reviewerName: input.reviewerName ?? null,
        reviewerEmail: input.reviewerEmail ?? null,
        createdBy: principal.userId
      }).pipe(
        Effect.mapError(toCoreInternal('Failed to create review token')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(badRequest('Review token creation failed')),
          onSome: Effect.succeed
        }))
      )

      return created
    }),

  listReviewTokens: (principal, teamId, params) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort
      const tokenStore = yield* ContentReviewTokenStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)

      return yield* tokenStore.list(teamId, params).pipe(
        Effect.mapError(toCoreInternal('Failed to list review tokens'))
      )
    }),

  revokeReviewToken: (principal, teamId, tokenId) =>
    Effect.gen(function* () {
      const teamStore = yield* TeamStorePort
      const tokenStore = yield* ContentReviewTokenStorePort

      const team = yield* teamStore.getById(teamId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch team')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Team not found')),
          onSome: Effect.succeed
        }))
      )

      yield* requireOrgMembership(team.organizationId, principal.userId)
      yield* requireOrgAdmin(team.organizationId, principal.userId)

      const existing = yield* tokenStore.getById(tokenId).pipe(
        Effect.mapError(toCoreInternal('Failed to fetch review token')),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(notFound('Review token not found')),
          onSome: Effect.succeed
        }))
      )

      if (existing.teamId !== teamId) {
        return yield* Effect.fail(notFound('Review token not found'))
      }

      yield* tokenStore.revoke(tokenId).pipe(
        Effect.mapError(toCoreInternal('Failed to revoke review token'))
      )

      return { deleted: true as const }
    }),

  validateReviewToken: (token) =>
    Effect.gen(function* () {
      const tokenStore = yield* ContentReviewTokenStorePort

      const foundOpt = yield* tokenStore.findByToken(token).pipe(
        Effect.mapError(toCoreInternal('Failed to validate review token'))
      )

      if (Option.isNone(foundOpt)) {
        return { valid: false }
      }

      const found = foundOpt.value

      if (found.revokedAt) {
        return { valid: false }
      }

      if (found.expiresAt < new Date()) {
        return { valid: false }
      }

      yield* tokenStore.touchLastAccessed(found.id).pipe(
        Effect.catchAll((_cause) => Effect.void)
      )

      return {
        valid: true,
        token: found,
        teamId: found.teamId,
        permissions: [...found.permissions]
      }
    })
}
