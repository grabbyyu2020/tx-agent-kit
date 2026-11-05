import type {
  ShadowingCaptionKind,
  ShadowingFailureReason,
  ShadowingVideoStatus
} from '@tx-agent-kit/contracts'
import type { shadowingVideos } from '../schema.js'
import { generateId, generateTimestamp } from './factory-helpers.js'

type ShadowingVideoInsert = typeof shadowingVideos.$inferInsert

export interface CreateShadowingVideoFactoryOptions {
  id?: string
  userId?: string
  youtubeVideoId?: string
  title?: string
  thumbnailUrl?: string | null
  durationSeconds?: number | null
  captionKind?: ShadowingCaptionKind | null
  status?: ShadowingVideoStatus
  failureReason?: ShadowingFailureReason | null
  failureMessage?: string | null
  sentenceCount?: number
  lastSegmentIndex?: number
  createdAt?: Date
  updatedAt?: Date
}

// 11 hex characters (a subset of the YouTube id alphabet) from a random UUID,
// so parallel workers do not collide on the (user, youtube id) unique index.
const generateYoutubeVideoId = (): string => generateId().replaceAll('-', '').slice(0, 11)

/**
 * Factory for the `shadowing_videos` table. Defaults to a freshly-imported
 * `importing` row (no metadata, no failure) — the shape the import endpoint
 * creates before the workflow runs.
 */
export const createShadowingVideoFactory = (
  options: CreateShadowingVideoFactoryOptions = {}
): ShadowingVideoInsert => ({
  id: options.id ?? generateId(),
  userId: options.userId ?? generateId(),
  youtubeVideoId: options.youtubeVideoId ?? generateYoutubeVideoId(),
  title: options.title ?? '',
  thumbnailUrl: options.thumbnailUrl ?? null,
  durationSeconds: options.durationSeconds ?? null,
  captionKind: options.captionKind ?? null,
  status: options.status ?? 'importing',
  failureReason: options.failureReason ?? null,
  failureMessage: options.failureMessage ?? null,
  sentenceCount: options.sentenceCount ?? 0,
  lastSegmentIndex: options.lastSegmentIndex ?? 0,
  createdAt: options.createdAt ?? generateTimestamp(),
  updatedAt: options.updatedAt ?? generateTimestamp()
})
