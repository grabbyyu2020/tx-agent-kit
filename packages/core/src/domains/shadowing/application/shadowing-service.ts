import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, conflict, internalError, notFound, type CoreError } from '../../../errors.js'
import type {
  ImportShadowingVideoResult,
  ShadowingSentenceRecord,
  ShadowingVideoDetailAggregate,
  ShadowingVideoRecord
} from '../domain/shadowing-domain.js'
import { parseYoutubeVideoId } from '../domain/youtube-url.js'
import { ShadowingStorePort } from '../ports/shadowing-ports.js'

const videoNotFoundMessage = 'Shadowing video not found'
const sentenceNotFoundMessage = 'Shadowing sentence not found'

const toCoreInternal = (message: string) => (cause: unknown): CoreError => internalError(message, cause)

const isIndex = (value: number): boolean => Number.isInteger(value) && value >= 0

/** The caller's video; another user's video fails exactly like a missing one. */
const requireOwnedVideo = (userId: string, videoId: string) =>
  Effect.gen(function* () {
    const store = yield* ShadowingStorePort
    const video = yield* store
      .findVideoForUser(userId, videoId)
      .pipe(Effect.mapError(toCoreInternal('Failed to fetch shadowing video')))
    if (Option.isNone(video)) {
      return yield* Effect.fail(notFound(videoNotFoundMessage))
    }
    return video.value
  })

/**
 * Shadowing use cases for the authenticated learner (API side). Every operation is scoped to
 * `userId`: a video owned by someone else is NOT_FOUND, exactly like a missing id
 * (INV-SHADOW-018). Reads are served from the store only and never reach the LLM (INV-SHADOW-013).
 */
export class ShadowingService extends Context.Tag('ShadowingService')<
  ShadowingService,
  {
    /** BAD_REQUEST (nothing written) for a non-YouTube URL; the existing video with `created: false` on re-submit. */
    importVideo: (userId: string, url: string) => Effect.Effect<ImportShadowingVideoResult, CoreError, ShadowingStorePort>
    /** Newest first. */
    listVideos: (userId: string) => Effect.Effect<ReadonlyArray<ShadowingVideoRecord>, CoreError, ShadowingStorePort>
    getVideo: (userId: string, videoId: string) => Effect.Effect<ShadowingVideoDetailAggregate, CoreError, ShadowingStorePort>
    deleteVideo: (userId: string, videoId: string) => Effect.Effect<void, CoreError, ShadowingStorePort>
    /** CONFLICT unless the video is `failed`; returns the video reset to `importing`. */
    retryImport: (userId: string, videoId: string) => Effect.Effect<ShadowingVideoRecord, CoreError, ShadowingStorePort>
    /** BAD_REQUEST when `segmentIndex` is not one of the video's segments. */
    saveProgress: (
      userId: string,
      videoId: string,
      segmentIndex: number
    ) => Effect.Effect<void, CoreError, ShadowingStorePort>
    /** NOT_FOUND when the sentence does not exist; succeeds without effect when nothing in its batch is pending. */
    prioritizeSentence: (
      userId: string,
      videoId: string,
      sentenceIndex: number
    ) => Effect.Effect<void, CoreError, ShadowingStorePort>
    /** NOT_FOUND for a missing sentence, CONFLICT while `pending` or `regenerating`; returns the `regenerating` sentence. */
    regenerateExplanation: (
      userId: string,
      videoId: string,
      sentenceIndex: number
    ) => Effect.Effect<ShadowingSentenceRecord, CoreError, ShadowingStorePort>
  }
>() {}

export const ShadowingServiceLive = Layer.succeed(ShadowingService, {
  importVideo: (userId, url) =>
    Effect.gen(function* () {
      const youtubeVideoId = parseYoutubeVideoId(url)
      if (Option.isNone(youtubeVideoId)) {
        return yield* Effect.fail(badRequest('Not a recognisable YouTube video URL'))
      }
      const store = yield* ShadowingStorePort
      const existing = yield* store
        .findVideoByYoutubeId(userId, youtubeVideoId.value)
        .pipe(Effect.mapError(toCoreInternal('Failed to look up shadowing video')))
      if (Option.isSome(existing)) {
        return { video: existing.value, created: false }
      }
      return yield* store
        .insertVideoWithImportEvent({ userId, youtubeVideoId: youtubeVideoId.value })
        .pipe(Effect.mapError(toCoreInternal('Failed to import shadowing video')))
    }),

  listVideos: (userId) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      return yield* store
        .listVideosForUser(userId)
        .pipe(Effect.mapError(toCoreInternal('Failed to list shadowing videos')))
    }),

  getVideo: (userId, videoId) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      const detail = yield* store
        .getVideoDetail(videoId)
        .pipe(Effect.mapError(toCoreInternal('Failed to fetch shadowing video')))
      if (Option.isNone(detail) || detail.value.video.userId !== userId) {
        return yield* Effect.fail(notFound(videoNotFoundMessage))
      }
      return detail.value
    }),

  deleteVideo: (userId, videoId) =>
    Effect.gen(function* () {
      yield* requireOwnedVideo(userId, videoId)
      const store = yield* ShadowingStorePort
      const deleted = yield* store
        .deleteVideo(videoId)
        .pipe(Effect.mapError(toCoreInternal('Failed to delete shadowing video')))
      if (!deleted) {
        return yield* Effect.fail(notFound(videoNotFoundMessage))
      }
    }),

  retryImport: (userId, videoId) =>
    Effect.gen(function* () {
      const video = yield* requireOwnedVideo(userId, videoId)
      if (video.status !== 'failed') {
        return yield* Effect.fail(conflict('Only a failed import can be retried', { status: video.status }))
      }
      const store = yield* ShadowingStorePort
      const reset = yield* store
        .resetVideoForRetry(videoId)
        .pipe(Effect.mapError(toCoreInternal('Failed to retry shadowing import')))
      if (Option.isNone(reset)) {
        // The status changed between the read and the conditional update.
        return yield* Effect.fail(conflict('Only a failed import can be retried'))
      }
      return reset.value
    }),

  saveProgress: (userId, videoId, segmentIndex) =>
    Effect.gen(function* () {
      yield* requireOwnedVideo(userId, videoId)
      const outOfRange = badRequest("Segment index is outside the video's segments", { segmentIndex })
      if (!isIndex(segmentIndex)) {
        return yield* Effect.fail(outOfRange)
      }
      const store = yield* ShadowingStorePort
      const saved = yield* store
        .saveProgress(videoId, segmentIndex)
        .pipe(Effect.mapError(toCoreInternal('Failed to save shadowing progress')))
      if (!saved) {
        return yield* Effect.fail(outOfRange)
      }
    }),

  prioritizeSentence: (userId, videoId, sentenceIndex) =>
    Effect.gen(function* () {
      const video = yield* requireOwnedVideo(userId, videoId)
      // Sentence indexes are contiguous 0..sentenceCount-1 (replaced as a whole per import).
      if (!isIndex(sentenceIndex) || sentenceIndex >= video.sentenceCount) {
        return yield* Effect.fail(notFound(sentenceNotFoundMessage))
      }
      const store = yield* ShadowingStorePort
      yield* store
        .prioritizeBatchOfSentence(videoId, sentenceIndex)
        .pipe(Effect.mapError(toCoreInternal('Failed to prioritize shadowing explanations')))
    }),

  regenerateExplanation: (userId, videoId, sentenceIndex) =>
    Effect.gen(function* () {
      yield* requireOwnedVideo(userId, videoId)
      const store = yield* ShadowingStorePort
      const marked = yield* store
        .markSentenceRegenerating(videoId, sentenceIndex)
        .pipe(Effect.mapError(toCoreInternal('Failed to request explanation regeneration')))
      if (Option.isSome(marked)) {
        return marked.value
      }
      // Not accepted: tell a missing sentence apart from one in pending/regenerating.
      const sentences = yield* store
        .listSentences(videoId)
        .pipe(Effect.mapError(toCoreInternal('Failed to fetch shadowing sentences')))
      const sentence = sentences.find((candidate) => candidate.sentenceIndex === sentenceIndex)
      if (sentence === undefined) {
        return yield* Effect.fail(notFound(sentenceNotFoundMessage))
      }
      return yield* Effect.fail(
        conflict('Explanation is already being generated', { explanationStatus: sentence.explanationStatus })
      )
    })
})
