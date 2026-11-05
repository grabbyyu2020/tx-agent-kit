import * as Schema from 'effect/Schema'
import { shadowingExplanationSchema, shadowingExplanationStatuses } from '@tx-agent-kit/contracts'

/**
 * Effect schema for the `shadowing_sentences` table row. `explanation` is the
 * contracts' structured explanation (meaning, keyExpressions, toneAndContext).
 *
 * @spec youtube-shadowing-design §"Data Model"
 */
export const shadowingSentenceRowSchema = Schema.Struct({
  id: Schema.UUID,
  videoId: Schema.UUID,
  sentenceIndex: Schema.Int,
  batchIndex: Schema.Int,
  text: Schema.String,
  startMs: Schema.Int,
  endMs: Schema.Int,
  explanation: Schema.NullOr(shadowingExplanationSchema),
  explanationStatus: Schema.Literal(...shadowingExplanationStatuses),
  explanationRequestedAt: Schema.NullOr(Schema.DateFromSelf),
  updatedAt: Schema.DateFromSelf
})

export type ShadowingSentenceRowShape = Schema.Schema.Type<typeof shadowingSentenceRowSchema>
