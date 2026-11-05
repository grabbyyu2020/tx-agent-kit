import type { ShadowingCaptionKind, ShadowingVideoStatus } from '@tx-agent-kit/contracts'
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type * as Either from 'effect/Either'
import type * as Option from 'effect/Option'
import type { CaptionWord } from '../domain/caption-transcript.js'
import type { ShadowingExplanation } from '../domain/explanation.js'
import type {
  ImportShadowingVideoResult,
  InsertShadowingVideoCommand,
  NewShadowingSegmentInput,
  NewShadowingSentenceInput,
  ShadowingSentenceRecord,
  ShadowingVideoDetailAggregate,
  ShadowingVideoFailureInput,
  ShadowingVideoMetadataInput,
  ShadowingVideoRecord
} from '../domain/shadowing-domain.js'
import type {
  CaptionSourceError,
  LlmCallError,
  LlmNotConfiguredError,
  NoCaptionsError,
  NotEmbeddableError
} from '../domain/shadowing-errors.js'
import type { YoutubeVideoId } from '../domain/youtube-url.js'

/**
 * Repository-kind tag required by `enforce-route-kind-contracts.mjs`.
 * Shadowing ports are workflow-shaped (import, transcript, explanations), not CRUD.
 */
export const ShadowingRepositoryKind = 'custom' as const

/** Video metadata reported by the caption source. */
export type ShadowingVideoSourceMetadata = {
  readonly title: string
  readonly thumbnailUrl: string | null
  readonly durationSeconds: number | null
}

/** Metadata plus parsed caption words for one video; raw caption files are never kept. */
export type ShadowingVideoSource = {
  readonly metadata: ShadowingVideoSourceMetadata
  readonly captionKind: ShadowingCaptionKind
  readonly words: ReadonlyArray<CaptionWord>
}

export type SegmentSentencesInput = {
  readonly title: string
  readonly words: ReadonlyArray<string>
}

export type ExplainBatchInput = {
  readonly title: string
  readonly sentences: ReadonlyArray<string>
  readonly targetIndexes: ReadonlyArray<number>
}

/** Fetches metadata and English captions for a validated YouTube video id. */
export class CaptionSourcePort extends Context.Tag('CaptionSourcePort')<
  CaptionSourcePort,
  {
    fetchVideoSource: (
      youtubeVideoId: YoutubeVideoId
    ) => Effect.Effect<ShadowingVideoSource, NoCaptionsError | NotEmbeddableError | CaptionSourceError>
  }
>() {}

/** LLM steps of the import: sentence segmentation and batched Chinese explanations. */
export class ShadowingLlmPort extends Context.Tag('ShadowingLlmPort')<
  ShadowingLlmPort,
  {
    segmentSentences: (
      input: SegmentSentencesInput
    ) => Effect.Effect<ReadonlyArray<string>, LlmCallError | LlmNotConfiguredError>
    explainSentences: (
      input: ExplainBatchInput
    ) => Effect.Effect<ReadonlyMap<number, ShadowingExplanation>, LlmCallError | LlmNotConfiguredError>
  }
>() {}

/**
 * Persistence for shadowing videos, sentences and segments. Writes that need an outbox event
 * (insert, retry, regenerate) write it in the same transaction. Errors are opaque; services
 * translate them at their seam.
 */
export class ShadowingStorePort extends Context.Tag('ShadowingStorePort')<
  ShadowingStorePort,
  {
    findVideoForUser: (userId: string, videoId: string) => Effect.Effect<Option.Option<ShadowingVideoRecord>, unknown>
    findVideoByYoutubeId: (
      userId: string,
      youtubeVideoId: string
    ) => Effect.Effect<Option.Option<ShadowingVideoRecord>, unknown>
    /** Inserts an `importing` video + import event; an existing (user, YouTube id) row is returned with `created: false`. */
    insertVideoWithImportEvent: (input: InsertShadowingVideoCommand) => Effect.Effect<ImportShadowingVideoResult, unknown>
    /** Newest first. */
    listVideosForUser: (userId: string) => Effect.Effect<ReadonlyArray<ShadowingVideoRecord>, unknown>
    /** Not owner-scoped; none when the video does not exist. */
    getVideoDetail: (videoId: string) => Effect.Effect<Option.Option<ShadowingVideoDetailAggregate>, unknown>
    /** Whether a row was deleted (sentences and segments cascade). */
    deleteVideo: (videoId: string) => Effect.Effect<boolean, unknown>
    /** Only from `failed` (+ new import event); none otherwise. */
    resetVideoForRetry: (videoId: string) => Effect.Effect<Option.Option<ShadowingVideoRecord>, unknown>
    /** False (nothing written) when `segmentIndex` is not an existing segment. */
    saveProgress: (videoId: string, segmentIndex: number) => Effect.Effect<boolean, unknown>
    /** Number of pending sentences in the sentence's batch marked as requested now. */
    prioritizeBatchOfSentence: (videoId: string, sentenceIndex: number) => Effect.Effect<number, unknown>
    /** Only from `ready` or `failed` (+ regenerate event); none otherwise or when the sentence is missing. */
    markSentenceRegenerating: (
      videoId: string,
      sentenceIndex: number
    ) => Effect.Effect<Option.Option<ShadowingSentenceRecord>, unknown>
    findSentenceById: (sentenceId: string) => Effect.Effect<Option.Option<ShadowingSentenceRecord>, unknown>
    updateVideoMetadata: (videoId: string, metadata: ShadowingVideoMetadataInput) => Effect.Effect<void, unknown>
    /** Deletes and re-inserts sentences + segments, sets `sentenceCount` and status `explaining`, in one transaction. */
    replaceTranscript: (
      videoId: string,
      sentences: ReadonlyArray<NewShadowingSentenceInput>,
      segments: ReadonlyArray<NewShadowingSegmentInput>
    ) => Effect.Effect<void, unknown>
    /** `failed` requires `failure`; other statuses clear it. */
    setVideoStatus: (
      videoId: string,
      status: ShadowingVideoStatus,
      failure?: ShadowingVideoFailureInput
    ) => Effect.Effect<void, unknown>
    /** Latest-requested pending batch first, else the lowest pending batch; none when nothing is pending. */
    nextPendingBatchIndex: (videoId: string) => Effect.Effect<Option.Option<number>, unknown>
    /** By sentence index. */
    listSentences: (videoId: string) => Effect.Effect<ReadonlyArray<ShadowingSentenceRecord>, unknown>
    /** Stores explanations only for sentences of the batch still `pending`; returns how many were stored. */
    storeExplanations: (
      videoId: string,
      batchIndex: number,
      explanations: ReadonlyMap<number, ShadowingExplanation>
    ) => Effect.Effect<number, unknown>
    /** Pending sentences of the batch → `failed`; returns how many were touched. */
    markBatchFailed: (videoId: string, batchIndex: number) => Effect.Effect<number, unknown>
    /** From `regenerating` only: Right → `ready` with the explanation, Left → `failed`. Whether it was updated. */
    finishRegeneration: (
      sentenceId: string,
      result: Either.Either<ShadowingExplanation, string>
    ) => Effect.Effect<boolean, unknown>
  }
>() {}
