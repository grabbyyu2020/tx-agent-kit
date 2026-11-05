import type { ShadowingExplanation, ShadowingExplanationStatus } from '@tx-agent-kit/contracts'
import type { shadowingSentences } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type ShadowingSentenceInsert = typeof shadowingSentences.$inferInsert

export interface CreateShadowingSentenceFactoryOptions {
  id?: string
  videoId?: string
  sentenceIndex?: number
  batchIndex?: number
  text?: string
  startMs?: number
  endMs?: number
  explanation?: ShadowingExplanation | null
  explanationStatus?: ShadowingExplanationStatus
  explanationRequestedAt?: Date | null
  updatedAt?: Date
}

/**
 * Factory for the `shadowing_sentences` table. Defaults to a `pending`
 * sentence without an explanation (the DB CHECK forbids an explanation on a
 * pending row and requires one on a ready row).
 */
export const createShadowingSentenceFactory = (
  options: CreateShadowingSentenceFactoryOptions = {}
): ShadowingSentenceInsert => ({
  id: options.id ?? generateId(),
  videoId: options.videoId ?? generateId(),
  sentenceIndex: options.sentenceIndex ?? 0,
  batchIndex: options.batchIndex ?? 0,
  text: options.text ?? 'This is a sample sentence.',
  startMs: options.startMs ?? 0,
  endMs: options.endMs ?? 2000,
  explanation: options.explanation ?? null,
  explanationStatus: options.explanationStatus ?? 'pending',
  explanationRequestedAt: options.explanationRequestedAt ?? null,
  updatedAt: options.updatedAt ?? generateTimestamp()
})
