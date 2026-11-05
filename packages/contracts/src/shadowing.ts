import * as Schema from 'effect/Schema'
import {
  shadowingCaptionKinds,
  shadowingExplanationStatuses,
  shadowingFailureReasons,
  shadowingVideoStatuses
} from './literals.js'

// --- Video schemas ---

export const importShadowingVideoBodySchema = Schema.Struct({
  url: Schema.String.pipe(Schema.maxLength(2048))
})

export const shadowingVideoSummarySchema = Schema.Struct({
  id: Schema.UUID,
  youtubeVideoId: Schema.String,
  title: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(Schema.Int),
  captionKind: Schema.NullOr(Schema.Literal(...shadowingCaptionKinds)),
  status: Schema.Literal(...shadowingVideoStatuses),
  failureReason: Schema.NullOr(Schema.Literal(...shadowingFailureReasons)),
  failureMessage: Schema.NullOr(Schema.String),
  sentenceCount: Schema.Int,
  explainedCount: Schema.Int,
  lastSegmentIndex: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const importShadowingVideoResponseSchema = Schema.Struct({
  video: shadowingVideoSummarySchema,
  created: Schema.Boolean
})

export const shadowingVideoListResponseSchema = Schema.Struct({
  data: Schema.Array(shadowingVideoSummarySchema)
})

// --- Sentence and segment schemas ---

export const shadowingKeyExpressionSchema = Schema.Struct({
  /** English, verbatim from the sentence. */
  expression: Schema.String,
  /** Chinese. */
  explanation: Schema.String
})

export const shadowingExplanationSchema = Schema.Struct({
  /** Chinese paraphrase of the whole sentence. */
  meaning: Schema.String,
  keyExpressions: Schema.Array(shadowingKeyExpressionSchema),
  /** Chinese. */
  toneAndContext: Schema.String
})

export const shadowingSentenceSchema = Schema.Struct({
  id: Schema.UUID,
  sentenceIndex: Schema.Int,
  batchIndex: Schema.Int,
  text: Schema.String,
  startMs: Schema.Int,
  endMs: Schema.Int,
  explanationStatus: Schema.Literal(...shadowingExplanationStatuses),
  explanation: Schema.NullOr(shadowingExplanationSchema)
})

export const shadowingSegmentSchema = Schema.Struct({
  segmentIndex: Schema.Int,
  sentenceIndex: Schema.Int,
  text: Schema.String,
  startMs: Schema.Int,
  endMs: Schema.Int
})

export const shadowingVideoDetailSchema = Schema.Struct({
  video: shadowingVideoSummarySchema,
  sentences: Schema.Array(shadowingSentenceSchema),
  segments: Schema.Array(shadowingSegmentSchema)
})

// --- Progress schemas ---

export const saveShadowingProgressBodySchema = Schema.Struct({
  segmentIndex: Schema.Int.pipe(Schema.nonNegative())
})

export const shadowingProgressResponseSchema = Schema.Struct({
  lastSegmentIndex: Schema.Int
})

export const shadowingPrioritizeResponseSchema = Schema.Struct({
  prioritized: Schema.Boolean
})

// --- Type exports ---

export type ImportShadowingVideoBody = Schema.Schema.Type<typeof importShadowingVideoBodySchema>
export type ShadowingVideoSummary = Schema.Schema.Type<typeof shadowingVideoSummarySchema>
export type ImportShadowingVideoResponse = Schema.Schema.Type<typeof importShadowingVideoResponseSchema>
export type ShadowingVideoListResponse = Schema.Schema.Type<typeof shadowingVideoListResponseSchema>
export type ShadowingKeyExpression = Schema.Schema.Type<typeof shadowingKeyExpressionSchema>
export type ShadowingExplanation = Schema.Schema.Type<typeof shadowingExplanationSchema>
export type ShadowingSentence = Schema.Schema.Type<typeof shadowingSentenceSchema>
export type ShadowingSegment = Schema.Schema.Type<typeof shadowingSegmentSchema>
export type ShadowingVideoDetail = Schema.Schema.Type<typeof shadowingVideoDetailSchema>
export type SaveShadowingProgressBody = Schema.Schema.Type<typeof saveShadowingProgressBodySchema>
export type ShadowingProgressResponse = Schema.Schema.Type<typeof shadowingProgressResponseSchema>
export type ShadowingPrioritizeResponse = Schema.Schema.Type<typeof shadowingPrioritizeResponseSchema>
