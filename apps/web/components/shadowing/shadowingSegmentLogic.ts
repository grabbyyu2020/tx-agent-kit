import { SHADOWING_PAUSE_PADDING_MS } from '@tx-agent-kit/contracts'

export type ShadowingPlaybackRate = 1 | 0.75

/** True once playback has reached the segment end plus the pause padding [INV-SHADOW-014]. */
export const shouldPauseAtSegmentEnd = (
  currentTimeSeconds: number,
  segment: { readonly endMs: number }
): boolean => currentTimeSeconds >= (segment.endMs + SHADOWING_PAUSE_PADDING_MS) / 1000

/** Next segment index, or null when already at the last segment. */
export const nextSegmentIndex = (index: number, segmentCount: number): number | null =>
  index + 1 < segmentCount ? Math.max(0, index + 1) : null

/** Previous segment index, or null when already at the first segment. */
export const previousSegmentIndex = (index: number, segmentCount: number): number | null =>
  index > 0 && segmentCount > 0 ? Math.min(segmentCount - 1, index - 1) : null

export const isValidSegmentIndex = (index: number, segmentCount: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < segmentCount

export const toggleShadowingRate = (rate: ShadowingPlaybackRate): ShadowingPlaybackRate =>
  rate === 1 ? 0.75 : 1

/** Position in `segments` of the first segment belonging to `sentenceIndex` [REQ-SHADOW-025]. */
export const findFirstSegmentIndexForSentence = (
  segments: ReadonlyArray<{ readonly sentenceIndex: number }>,
  sentenceIndex: number
): number | null => {
  const position = segments.findIndex((segment) => segment.sentenceIndex === sentenceIndex)
  return position === -1 ? null : position
}
