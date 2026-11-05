import * as Schema from 'effect/Schema'
import {
  shadowingCaptionKinds,
  shadowingFailureReasons,
  shadowingVideoStatuses
} from '@tx-agent-kit/contracts'

/**
 * Effect schema for the `shadowing_videos` table row. Mirrors the Drizzle
 * schema in `../schema.ts` — keep the two in sync.
 *
 * @spec youtube-shadowing-design §"Data Model"
 */
export const shadowingVideoRowSchema = Schema.Struct({
  id: Schema.UUID,
  userId: Schema.UUID,
  youtubeVideoId: Schema.String,
  title: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(Schema.Int),
  captionKind: Schema.NullOr(Schema.Literal(...shadowingCaptionKinds)),
  status: Schema.Literal(...shadowingVideoStatuses),
  failureReason: Schema.NullOr(Schema.Literal(...shadowingFailureReasons)),
  failureMessage: Schema.NullOr(Schema.String),
  sentenceCount: Schema.Int,
  lastSegmentIndex: Schema.Int,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type ShadowingVideoRowShape = Schema.Schema.Type<typeof shadowingVideoRowSchema>
