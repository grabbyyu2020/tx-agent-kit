import type { ShadowingListVideos200DataItem } from '@/lib/api/generated/schemas'

type ShadowingVideoStatusFields = Pick<ShadowingListVideos200DataItem, 'status' | 'failureReason'>

/** Library badge text for a video's import status. */
export const shadowingVideoStatusLabel = ({ status, failureReason }: ShadowingVideoStatusFields): string => {
  switch (status) {
    case 'importing':
      return '导入中'
    case 'explaining':
      return '生成解读中'
    case 'ready':
      return '可练习'
    case 'failed':
      return failureReason === 'import_error' || failureReason === null ? '导入失败' : '不支持'
  }
}

/** Why a failed video cannot be practiced [REQ-SHADOW-401, REQ-SHADOW-402, REQ-SHADOW-406]. */
export const shadowingFailureLabel = (failureReason: ShadowingListVideos200DataItem['failureReason']): string => {
  switch (failureReason) {
    case 'no_captions':
      return '不支持：该视频没有英文字幕'
    case 'not_embeddable':
      return '不支持：该视频不允许嵌入播放'
    case 'import_error':
    case null:
      return '导入失败'
  }
}

/** Background work is still running, so the page should poll. */
export const isShadowingVideoInProgress = ({ status }: Pick<ShadowingListVideos200DataItem, 'status'>): boolean =>
  status === 'importing' || status === 'explaining'

/** Practice opens once batch 0 is settled, which is when the video becomes `ready` [REQ-SHADOW-015]. */
export const isShadowingVideoPracticable = ({ status }: Pick<ShadowingListVideos200DataItem, 'status'>): boolean =>
  status === 'ready'

/** `mm:ss` (minutes are not capped at 59); `--:--` when the duration is unknown. */
export const formatShadowingDuration = (durationSeconds: number | null): string => {
  if (durationSeconds === null) {
    return '--:--'
  }
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const SHADOWING_POLL_INTERVAL_MS = 3000
