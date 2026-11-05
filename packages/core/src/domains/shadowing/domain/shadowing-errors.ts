import type { ShadowingFailureReason } from '@tx-agent-kit/contracts'
import { Data } from 'effect'

/** The video has no usable English caption track. */
export class NoCaptionsError extends Data.TaggedError('NoCaptionsError')<{
  readonly youtubeVideoId: string
}> {}

/** The video cannot be embedded, so it cannot be practised in the IFrame player. */
export class NotEmbeddableError extends Data.TaggedError('NotEmbeddableError')<{
  readonly youtubeVideoId: string
}> {}

/** Fetching or parsing captions failed for any other reason. */
export class CaptionSourceError extends Data.TaggedError('CaptionSourceError')<{
  readonly message: string
}> {}

/** The LLM call failed (transport, HTTP status, or unparseable body). */
export class LlmCallError extends Data.TaggedError('LlmCallError')<{
  readonly message: string
  readonly status?: number
}> {}

/** Required LLM environment variables are missing. */
export class LlmNotConfiguredError extends Data.TaggedError('LlmNotConfiguredError')<{
  readonly missing: ReadonlyArray<string>
}> {}

/**
 * The LLM sentences do not reproduce the caption words. Positions refer to the first mismatch:
 * `sentenceIndex`/`tokenIndex` in the LLM output (whitespace tokens), `wordIndex` in the caption
 * words; `expected`/`actual` are normalised tokens (`null` when one side ran out).
 */
export class SentenceAlignmentError extends Data.TaggedError('SentenceAlignmentError')<{
  readonly message: string
  readonly sentenceIndex: number
  readonly tokenIndex: number
  readonly wordIndex: number
  readonly expected: string | null
  readonly actual: string | null
}> {}

export type ExplanationDecodeFailure = 'schema' | 'index_mismatch' | 'expression_not_in_sentence'

/** An explanation batch from the LLM does not match the required shape or sentence set. */
export class ExplanationDecodeError extends Data.TaggedError('ExplanationDecodeError')<{
  readonly reason: ExplanationDecodeFailure
  readonly message: string
  readonly sentenceIndex?: number
}> {}

/** A store (database) operation failed while importing or explaining; always retryable. */
export class ShadowingStoreError extends Data.TaggedError('ShadowingStoreError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Every failure the worker-side shadowing use cases can report. */
export type ShadowingImportError =
  | NoCaptionsError
  | NotEmbeddableError
  | CaptionSourceError
  | LlmCallError
  | LlmNotConfiguredError
  | SentenceAlignmentError
  | ShadowingStoreError

/** How a failed import step is reported: the stored failure reason, its message, and whether to retry. */
export interface ShadowingImportFailureSummary {
  readonly reason: ShadowingFailureReason
  readonly message: string
  readonly retryable: boolean
}

/**
 * Classify a worker-side failure. Missing captions, non-embeddable videos and a missing LLM
 * configuration can never succeed on retry; everything else (yt-dlp, network, LLM output,
 * alignment, database) is retryable and reported as `import_error`.
 */
export const classifyShadowingImportError = (error: ShadowingImportError): ShadowingImportFailureSummary => {
  switch (error._tag) {
    case 'NoCaptionsError': {
      return { reason: 'no_captions', message: `Video ${error.youtubeVideoId} has no English captions`, retryable: false }
    }
    case 'NotEmbeddableError': {
      return { reason: 'not_embeddable', message: `Video ${error.youtubeVideoId} cannot be embedded`, retryable: false }
    }
    case 'LlmNotConfiguredError': {
      return {
        reason: 'import_error',
        message: `LLM is not configured; missing environment variables: ${error.missing.join(', ')}`,
        retryable: false
      }
    }
    case 'CaptionSourceError':
    case 'LlmCallError':
    case 'SentenceAlignmentError':
    case 'ShadowingStoreError': {
      return { reason: 'import_error', message: error.message, retryable: true }
    }
  }
}
