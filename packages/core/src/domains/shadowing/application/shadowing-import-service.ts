import {
  SHADOWING_SEGMENT_MAX_MS,
  SHADOWING_SEGMENT_MAX_WORDS,
  type ShadowingFailureReason
} from '@tx-agent-kit/contracts'
import { Context, Effect, Either, Layer, Option } from 'effect'
import { batchIndexOf } from '../domain/explanation.js'
import { compromiseClauseSplitter, splitIntoPracticeSegments } from '../domain/practice-segments.js'
import { alignSentences, type AlignedSentence } from '../domain/sentence-alignment.js'
import type { NewShadowingSegmentInput, NewShadowingSentenceInput } from '../domain/shadowing-domain.js'
import {
  CaptionSourceError,
  LlmCallError,
  ShadowingStoreError,
  type LlmNotConfiguredError,
  type NoCaptionsError,
  type NotEmbeddableError,
  type SentenceAlignmentError
} from '../domain/shadowing-errors.js'
import { isYoutubeVideoId } from '../domain/youtube-url.js'
import { CaptionSourcePort, ShadowingLlmPort, ShadowingStorePort } from '../ports/shadowing-ports.js'

export type PrepareShadowingTranscriptResult =
  | { readonly outcome: 'gone' }
  | { readonly outcome: 'ok'; readonly sentenceCount: number }

type ImportDeps = ShadowingStorePort | CaptionSourcePort | ShadowingLlmPort

const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  return typeof cause === 'string' ? cause : 'unknown error'
}

/** Run a store call, turning its opaque failure into a retryable {@link ShadowingStoreError}. */
const fromStore = <A>(message: string, effect: Effect.Effect<A, unknown>): Effect.Effect<A, ShadowingStoreError> =>
  effect.pipe(Effect.mapError((cause) => new ShadowingStoreError({ message: `${message}: ${describeCause(cause)}`, cause })))

/** Sentences (batch from the sentence index) and their practice segments, indexed across the whole video. */
const buildTranscript = (aligned: ReadonlyArray<AlignedSentence>) => {
  const sentences: NewShadowingSentenceInput[] = []
  const segments: NewShadowingSegmentInput[] = []
  for (const [sentenceIndex, sentence] of aligned.entries()) {
    sentences.push({
      sentenceIndex,
      batchIndex: batchIndexOf(sentenceIndex),
      text: sentence.text,
      startMs: sentence.startMs,
      endMs: sentence.endMs
    })
    const parts = splitIntoPracticeSegments(
      sentence,
      { maxWords: SHADOWING_SEGMENT_MAX_WORDS, maxMs: SHADOWING_SEGMENT_MAX_MS },
      compromiseClauseSplitter
    )
    for (const part of parts) {
      segments.push({
        segmentIndex: segments.length,
        sentenceIndex,
        text: part.text,
        startMs: part.startMs,
        endMs: part.endMs
      })
    }
  }
  return { sentences, segments }
}

/**
 * Worker-side shadowing use cases, one per Temporal activity. Failures are domain errors; use
 * `classifyShadowingImportError` to decide between a retry and a non-retryable failure reason.
 * Every operation tolerates a video deleted mid-workflow ("gone" / no-op).
 */
export class ShadowingImportService extends Context.Tag('ShadowingImportService')<
  ShadowingImportService,
  {
    /**
     * Fetch metadata + captions, segment them into sentences with the LLM, align the sentences
     * to the caption words, split practice segments, and replace the stored transcript
     * (status → `explaining`).
     */
    prepareTranscript: (
      videoId: string
    ) => Effect.Effect<
      PrepareShadowingTranscriptResult,
      | NoCaptionsError
      | NotEmbeddableError
      | CaptionSourceError
      | LlmCallError
      | LlmNotConfiguredError
      | SentenceAlignmentError
      | ShadowingStoreError,
      ImportDeps
    >
    /** The batch to explain next; none when nothing is pending or the video is gone. */
    nextBatch: (videoId: string) => Effect.Effect<Option.Option<number>, ShadowingStoreError, ImportDeps>
    /** Explains the still-pending sentences of the batch against the full transcript; returns how many were stored. */
    explainBatch: (
      videoId: string,
      batchIndex: number
    ) => Effect.Effect<number, LlmCallError | LlmNotConfiguredError | ShadowingStoreError, ImportDeps>
    /** Pending sentences of the batch → `failed`; returns how many. */
    markBatchFailed: (videoId: string, batchIndex: number) => Effect.Effect<number, ShadowingStoreError, ImportDeps>
    /** Video → `failed` with reason and message; no-op when the video is gone. */
    failImport: (
      videoId: string,
      reason: ShadowingFailureReason,
      message: string
    ) => Effect.Effect<void, ShadowingStoreError, ImportDeps>
    /** `explaining` → `ready`; any other status (notably `failed`) is left alone. Idempotent. */
    markReady: (videoId: string) => Effect.Effect<void, ShadowingStoreError, ImportDeps>
    /** Explains one `regenerating` sentence and stores the result; no-op for any other status or a gone sentence. */
    regenerate: (
      sentenceId: string
    ) => Effect.Effect<void, LlmCallError | LlmNotConfiguredError | ShadowingStoreError, ImportDeps>
    /** `regenerating` → `failed`, keeping the previous explanation. */
    failRegeneration: (sentenceId: string, message: string) => Effect.Effect<void, ShadowingStoreError, ImportDeps>
  }
>() {}

export const ShadowingImportServiceLive = Layer.succeed(ShadowingImportService, {
  prepareTranscript: (videoId) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      const captions = yield* CaptionSourcePort
      const llm = yield* ShadowingLlmPort

      const detail = yield* fromStore('Failed to load shadowing video', store.getVideoDetail(videoId))
      if (Option.isNone(detail)) {
        return { outcome: 'gone' } as const
      }
      const { youtubeVideoId } = detail.value.video
      if (!isYoutubeVideoId(youtubeVideoId)) {
        return yield* Effect.fail(new CaptionSourceError({ message: `Stored YouTube id is not valid: ${youtubeVideoId}` }))
      }

      const source = yield* captions.fetchVideoSource(youtubeVideoId)
      yield* fromStore(
        'Failed to update shadowing video metadata',
        store.updateVideoMetadata(videoId, {
          title: source.metadata.title,
          thumbnailUrl: source.metadata.thumbnailUrl,
          durationSeconds: source.metadata.durationSeconds,
          captionKind: source.captionKind
        })
      )

      const proposed = yield* llm.segmentSentences({
        title: source.metadata.title,
        words: source.words.map((word) => word.text)
      })
      const aligned = alignSentences(source.words, proposed)
      if (Either.isLeft(aligned)) {
        return yield* Effect.fail(aligned.left)
      }

      const transcript = buildTranscript(aligned.right)
      yield* fromStore(
        'Failed to store shadowing transcript',
        store.replaceTranscript(videoId, transcript.sentences, transcript.segments)
      )
      return { outcome: 'ok', sentenceCount: transcript.sentences.length } as const
    }),

  nextBatch: (videoId) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      return yield* fromStore('Failed to select next explanation batch', store.nextPendingBatchIndex(videoId))
    }),

  explainBatch: (videoId, batchIndex) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      const llm = yield* ShadowingLlmPort

      const detail = yield* fromStore('Failed to load shadowing video', store.getVideoDetail(videoId))
      if (Option.isNone(detail)) {
        return 0
      }
      const { video, sentences } = detail.value
      const targetIndexes = sentences
        .filter((sentence) => sentence.batchIndex === batchIndex && sentence.explanationStatus === 'pending')
        .map((sentence) => sentence.sentenceIndex)
      if (targetIndexes.length === 0) {
        return 0
      }

      const explanations = yield* llm.explainSentences({
        title: video.title,
        sentences: sentences.map((sentence) => sentence.text),
        targetIndexes
      })
      return yield* fromStore(
        'Failed to store shadowing explanations',
        store.storeExplanations(videoId, batchIndex, explanations)
      )
    }),

  markBatchFailed: (videoId, batchIndex) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      return yield* fromStore('Failed to mark explanation batch failed', store.markBatchFailed(videoId, batchIndex))
    }),

  failImport: (videoId, reason, message) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      // The update matches no row once the video is deleted.
      yield* fromStore('Failed to mark shadowing import failed', store.setVideoStatus(videoId, 'failed', { reason, message }))
    }),

  markReady: (videoId) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      const detail = yield* fromStore('Failed to load shadowing video', store.getVideoDetail(videoId))
      if (Option.isNone(detail) || detail.value.video.status !== 'explaining') {
        return
      }
      yield* fromStore('Failed to mark shadowing video ready', store.setVideoStatus(videoId, 'ready'))
    }),

  regenerate: (sentenceId) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      const llm = yield* ShadowingLlmPort

      const sentence = yield* fromStore('Failed to load shadowing sentence', store.findSentenceById(sentenceId))
      if (Option.isNone(sentence) || sentence.value.explanationStatus !== 'regenerating') {
        return
      }
      const detail = yield* fromStore('Failed to load shadowing video', store.getVideoDetail(sentence.value.videoId))
      if (Option.isNone(detail)) {
        return
      }

      const { sentenceIndex } = sentence.value
      const explanations = yield* llm.explainSentences({
        title: detail.value.video.title,
        sentences: detail.value.sentences.map((s) => s.text),
        targetIndexes: [sentenceIndex]
      })
      const explanation = explanations.get(sentenceIndex)
      if (explanation === undefined) {
        return yield* Effect.fail(new LlmCallError({ message: `No explanation returned for sentence ${sentenceIndex}` }))
      }
      yield* fromStore(
        'Failed to store regenerated explanation',
        store.finishRegeneration(sentenceId, Either.right(explanation))
      )
    }),

  failRegeneration: (sentenceId, message) =>
    Effect.gen(function* () {
      const store = yield* ShadowingStorePort
      yield* fromStore('Failed to mark regeneration failed', store.finishRegeneration(sentenceId, Either.left(message)))
    })
})
