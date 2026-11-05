import type {
  ShadowingSegmentRecord,
  ShadowingSentenceRecord,
  ShadowingVideoDetailAggregate,
  ShadowingVideoRecord
} from '@tx-agent-kit/core'

export const toApiShadowingVideoSummary = (record: ShadowingVideoRecord) => ({
  id: record.id,
  youtubeVideoId: record.youtubeVideoId,
  title: record.title,
  thumbnailUrl: record.thumbnailUrl,
  durationSeconds: record.durationSeconds,
  captionKind: record.captionKind,
  status: record.status,
  failureReason: record.failureReason,
  failureMessage: record.failureMessage,
  sentenceCount: record.sentenceCount,
  explainedCount: record.explainedCount,
  lastSegmentIndex: record.lastSegmentIndex,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
})

export const toApiShadowingSentence = (record: ShadowingSentenceRecord) => ({
  id: record.id,
  sentenceIndex: record.sentenceIndex,
  batchIndex: record.batchIndex,
  text: record.text,
  startMs: record.startMs,
  endMs: record.endMs,
  explanationStatus: record.explanationStatus,
  explanation: record.explanation
})

export const toApiShadowingSegment = (record: ShadowingSegmentRecord) => ({
  segmentIndex: record.segmentIndex,
  sentenceIndex: record.sentenceIndex,
  text: record.text,
  startMs: record.startMs,
  endMs: record.endMs
})

export const toApiShadowingVideoDetail = (aggregate: ShadowingVideoDetailAggregate) => ({
  video: toApiShadowingVideoSummary(aggregate.video),
  sentences: aggregate.sentences.map(toApiShadowingSentence),
  segments: aggregate.segments.map(toApiShadowingSegment)
})
