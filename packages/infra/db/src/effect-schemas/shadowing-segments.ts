import * as Schema from 'effect/Schema'

/**
 * Effect schema for the `shadowing_segments` table row.
 *
 * @spec youtube-shadowing-design §"Data Model"
 */
export const shadowingSegmentRowSchema = Schema.Struct({
  id: Schema.UUID,
  videoId: Schema.UUID,
  sentenceId: Schema.UUID,
  segmentIndex: Schema.Int,
  sentenceIndex: Schema.Int,
  text: Schema.String,
  startMs: Schema.Int,
  endMs: Schema.Int
})

export type ShadowingSegmentRowShape = Schema.Schema.Type<typeof shadowingSegmentRowSchema>
