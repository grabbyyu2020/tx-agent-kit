import { shadowingRepository } from '@tx-agent-kit/db'
import { Effect, Layer } from 'effect'
import {
  mapOptional,
  toImportShadowingVideoResult,
  toShadowingSentenceRecord,
  toShadowingVideoDetailAggregate,
  toShadowingVideoRecord
} from '../../../adapters/db-row-mappers.js'
import { ShadowingStorePort } from '../ports/shadowing-ports.js'

/**
 * Live {@link ShadowingStorePort} over the Drizzle `shadowingRepository`. Row → record mapping
 * goes through `core/src/adapters/db-row-mappers.ts` (`core-adapters-use-db-row-mappers`).
 */
export const ShadowingStorePortLive = Layer.succeed(ShadowingStorePort, {
  findVideoForUser: (userId, videoId) =>
    shadowingRepository
      .findVideoForUser(userId, videoId)
      .pipe(Effect.map((video) => mapOptional(video, toShadowingVideoRecord))),

  findVideoByYoutubeId: (userId, youtubeVideoId) =>
    shadowingRepository
      .findVideoByYoutubeId(userId, youtubeVideoId)
      .pipe(Effect.map((video) => mapOptional(video, toShadowingVideoRecord))),

  insertVideoWithImportEvent: (input) =>
    shadowingRepository
      .insertVideoWithImportEvent({ userId: input.userId, youtubeVideoId: input.youtubeVideoId })
      .pipe(Effect.map(toImportShadowingVideoResult)),

  listVideosForUser: (userId) =>
    shadowingRepository.listVideosForUser(userId).pipe(Effect.map((videos) => videos.map(toShadowingVideoRecord))),

  getVideoDetail: (videoId) =>
    shadowingRepository
      .getVideoDetail(videoId)
      .pipe(Effect.map((detail) => mapOptional(detail, toShadowingVideoDetailAggregate))),

  deleteVideo: (videoId) => shadowingRepository.deleteVideo(videoId),

  resetVideoForRetry: (videoId) =>
    shadowingRepository
      .resetVideoForRetry(videoId)
      .pipe(Effect.map((video) => mapOptional(video, toShadowingVideoRecord))),

  saveProgress: (videoId, segmentIndex) => shadowingRepository.saveProgress(videoId, segmentIndex),

  prioritizeBatchOfSentence: (videoId, sentenceIndex) =>
    shadowingRepository.prioritizeBatchOfSentence(videoId, sentenceIndex),

  markSentenceRegenerating: (videoId, sentenceIndex) =>
    shadowingRepository
      .markSentenceRegenerating(videoId, sentenceIndex)
      .pipe(Effect.map((sentence) => mapOptional(sentence, toShadowingSentenceRecord))),

  findSentenceById: (sentenceId) =>
    shadowingRepository
      .findSentenceById(sentenceId)
      .pipe(Effect.map((sentence) => mapOptional(sentence, toShadowingSentenceRecord))),

  updateVideoMetadata: (videoId, metadata) =>
    shadowingRepository.updateVideoMetadata(videoId, {
      title: metadata.title,
      thumbnailUrl: metadata.thumbnailUrl,
      durationSeconds: metadata.durationSeconds,
      captionKind: metadata.captionKind
    }),

  replaceTranscript: (videoId, sentences, segments) =>
    shadowingRepository.replaceTranscript(videoId, sentences, segments),

  setVideoStatus: (videoId, status, failure) => shadowingRepository.setVideoStatus(videoId, status, failure),

  nextPendingBatchIndex: (videoId) => shadowingRepository.nextPendingBatchIndex(videoId),

  listSentences: (videoId) =>
    shadowingRepository.listSentences(videoId).pipe(Effect.map((sentences) => sentences.map(toShadowingSentenceRecord))),

  storeExplanations: (videoId, batchIndex, explanations) =>
    shadowingRepository.storeExplanations(videoId, batchIndex, explanations),

  markBatchFailed: (videoId, batchIndex) => shadowingRepository.markBatchFailed(videoId, batchIndex),

  finishRegeneration: (sentenceId, result) => shadowingRepository.finishRegeneration(sentenceId, result)
})
