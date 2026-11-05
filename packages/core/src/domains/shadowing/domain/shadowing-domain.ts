import type {
  InsertShadowingVideoInput,
  ShadowingSegmentRowShape,
  ShadowingSentenceRowShape,
  ShadowingVideoRowShape
} from '@tx-agent-kit/db'

export type {
  NewShadowingSegmentInput,
  NewShadowingSentenceInput,
  ShadowingVideoFailureInput,
  ShadowingVideoMetadataInput
} from '@tx-agent-kit/db'

/** A video row plus `explainedCount` (sentences whose explanation is `ready`), computed in SQL. */
export interface ShadowingVideoRecord extends ShadowingVideoRowShape {
  readonly explainedCount: number
}

/** A transcript sentence with its explanation status and stored explanation. */
export type ShadowingSentenceRecord = ShadowingSentenceRowShape

/** A playable practice segment of one sentence. */
export type ShadowingSegmentRecord = ShadowingSegmentRowShape

/** A video with all of its sentences (by sentence index) and segments (by segment index). */
export interface ShadowingVideoDetailAggregate {
  readonly video: ShadowingVideoRecord
  readonly sentences: ReadonlyArray<ShadowingSentenceRecord>
  readonly segments: ReadonlyArray<ShadowingSegmentRecord>
}

/** Insert an `importing` video for (user, YouTube id). */
export type InsertShadowingVideoCommand = InsertShadowingVideoInput

/** The caller's video for the YouTube id; `created` is false when it already existed. */
export interface ImportShadowingVideoResult {
  readonly video: ShadowingVideoRecord
  readonly created: boolean
}
