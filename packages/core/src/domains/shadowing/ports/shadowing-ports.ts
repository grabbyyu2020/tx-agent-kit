import type { ShadowingCaptionKind } from '@tx-agent-kit/contracts'
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { CaptionWord } from '../domain/caption-transcript.js'
import type { ShadowingExplanation } from '../domain/explanation.js'
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
