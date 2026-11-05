import type {
  ShadowingSegmentRowShape,
  ShadowingSentenceRowShape,
  ShadowingVideoDetailShape,
  ShadowingVideoRecordShape
} from '@tx-agent-kit/db'
import type {
  ImportShadowingVideoResult,
  ShadowingSegmentRecord,
  ShadowingSentenceRecord,
  ShadowingVideoDetailAggregate,
  ShadowingVideoRecord
} from '../domains/shadowing/domain/shadowing-domain.js'

/**
 * Shadowing domain records alias the repository shapes (the video record already carries the
 * SQL-computed `explainedCount`), so these mappers are pass-throughs that keep the
 * `core-adapters-use-db-row-mappers` invariant in one place.
 */
export const toShadowingVideoRecord = (row: ShadowingVideoRecordShape): ShadowingVideoRecord => row

export const toShadowingSentenceRecord = (row: ShadowingSentenceRowShape): ShadowingSentenceRecord => row

export const toShadowingSegmentRecord = (row: ShadowingSegmentRowShape): ShadowingSegmentRecord => row

export const toShadowingVideoDetailAggregate = (detail: ShadowingVideoDetailShape): ShadowingVideoDetailAggregate => ({
  video: toShadowingVideoRecord(detail.video),
  sentences: detail.sentences.map(toShadowingSentenceRecord),
  segments: detail.segments.map(toShadowingSegmentRecord)
})

export const toImportShadowingVideoResult = (result: {
  readonly video: ShadowingVideoRecordShape
  readonly created: boolean
}): ImportShadowingVideoResult => ({ video: toShadowingVideoRecord(result.video), created: result.created })
