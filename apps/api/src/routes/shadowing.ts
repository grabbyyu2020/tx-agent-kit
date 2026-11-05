import { HttpApiBuilder } from '@effect/platform'
import { ShadowingService } from '@tx-agent-kit/core'
import { Effect } from 'effect'
import { TxAgentApi, mapCoreError } from '../api.js'
import {
  toApiShadowingSentence,
  toApiShadowingVideoDetail,
  toApiShadowingVideoSummary
} from '../mappers/shadowing-mapper.js'
import { requireAuth } from '../utils.js'

export const ShadowingRouteKind = 'custom' as const

/**
 * Per-user shadowing library. Every handler is scoped to the authenticated
 * principal; another user's video is a 404 exactly like a missing one.
 *
 * @spec youtube-shadowing-design §"API Endpoints"
 */
export const ShadowingLive = HttpApiBuilder.group(TxAgentApi, 'shadowing', (handlers) =>
  handlers
    .handle('importVideo', ({ payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        const result = yield* service.importVideo(principal.userId, payload.url).pipe(Effect.mapError(mapCoreError))
        return { video: toApiShadowingVideoSummary(result.video), created: result.created }
      })
    )
    .handle('listVideos', () =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        const videos = yield* service.listVideos(principal.userId).pipe(Effect.mapError(mapCoreError))
        return { data: videos.map(toApiShadowingVideoSummary) }
      })
    )
    .handle('getVideo', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        const detail = yield* service.getVideo(principal.userId, path.videoId).pipe(Effect.mapError(mapCoreError))
        return toApiShadowingVideoDetail(detail)
      })
    )
    .handle('deleteVideo', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        yield* service.deleteVideo(principal.userId, path.videoId).pipe(Effect.mapError(mapCoreError))
        return { deleted: true }
      })
    )
    .handle('retryImport', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        const video = yield* service.retryImport(principal.userId, path.videoId).pipe(Effect.mapError(mapCoreError))
        return toApiShadowingVideoSummary(video)
      })
    )
    .handle('saveProgress', ({ path, payload }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        yield* service
          .saveProgress(principal.userId, path.videoId, payload.segmentIndex)
          .pipe(Effect.mapError(mapCoreError))
        return { lastSegmentIndex: payload.segmentIndex }
      })
    )
    .handle('prioritizeSentence', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        yield* service
          .prioritizeSentence(principal.userId, path.videoId, path.sentenceIndex)
          .pipe(Effect.mapError(mapCoreError))
        return { prioritized: true }
      })
    )
    .handle('regenerateExplanation', ({ path }) =>
      Effect.gen(function* () {
        const principal = yield* requireAuth
        const service = yield* ShadowingService
        const sentence = yield* service
          .regenerateExplanation(principal.userId, path.videoId, path.sentenceIndex)
          .pipe(Effect.mapError(mapCoreError))
        return toApiShadowingSentence(sentence)
      })
    )
)
