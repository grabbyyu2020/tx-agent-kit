import type { shadowingSegments } from '../schema.js'
import { generateId } from './factory-helpers.js'

type ShadowingSegmentInsert = typeof shadowingSegments.$inferInsert

export interface CreateShadowingSegmentFactoryOptions {
  id?: string
  videoId?: string
  sentenceId?: string
  segmentIndex?: number
  sentenceIndex?: number
  text?: string
  startMs?: number
  endMs?: number
}

/**
 * Factory for the `shadowing_segments` table (a practice segment of one
 * sentence; `segmentIndex` is unique per video).
 */
export const createShadowingSegmentFactory = (
  options: CreateShadowingSegmentFactoryOptions = {}
): ShadowingSegmentInsert => ({
  id: options.id ?? generateId(),
  videoId: options.videoId ?? generateId(),
  sentenceId: options.sentenceId ?? generateId(),
  segmentIndex: options.segmentIndex ?? 0,
  sentenceIndex: options.sentenceIndex ?? 0,
  text: options.text ?? 'This is a sample sentence.',
  startMs: options.startMs ?? 0,
  endMs: options.endMs ?? 2000
})
