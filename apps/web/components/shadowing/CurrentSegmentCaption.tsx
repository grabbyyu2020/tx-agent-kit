'use client'

import type { MouseEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ShadowingPlaybackRate } from './shadowingSegmentLogic'

export interface CurrentSegmentCaptionProps {
  /** English text of the current segment; null when there is no segment. */
  readonly text: string | null
  readonly subtitleVisible: boolean
  readonly rate: ShadowingPlaybackRate
  readonly isPlaying: boolean
  /** Zero-based position of the current segment and the total, for the "n / total" indicator. */
  readonly segmentPosition: number
  readonly segmentCount: number
  readonly canGoPrevious: boolean
  readonly canGoNext: boolean
  readonly onPrevious: () => void
  readonly onReplay: () => void
  readonly onNext: () => void
  readonly onToggleRate: () => void
  readonly onToggleSubtitle: () => void
  readonly className?: string
}

// Mouse clicks must not leave focus on a control button, otherwise the next Space press would
// activate that button instead of replaying (see useShadowingShortcuts).
const keepFocus = (event: MouseEvent<HTMLButtonElement>) => {
  event.preventDefault()
}

function CaptionText({ text, subtitleVisible }: { readonly text: string | null; readonly subtitleVisible: boolean }) {
  if (text === null) {
    return <p className="text-muted-foreground text-sm">暂无句子</p>
  }
  if (!subtitleVisible) {
    return <p className="text-muted-foreground text-sm">字幕已隐藏（按 H 显示）</p>
  }
  return (
    <p className="text-lg leading-relaxed font-medium" lang="en">
      {text}
    </p>
  )
}

export function CurrentSegmentCaption({
  text,
  subtitleVisible,
  rate,
  isPlaying,
  segmentPosition,
  segmentCount,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onReplay,
  onNext,
  onToggleRate,
  onToggleSubtitle,
  className
}: CurrentSegmentCaptionProps) {
  return (
    <section aria-label="当前句子" className={cn('flex flex-col gap-3', className)}>
      <div
        className="bg-muted/40 flex min-h-16 items-center justify-center rounded-lg border px-4 py-3 text-center"
        data-testid="shadowing-current-caption"
      >
        <CaptionText text={text} subtitleVisible={subtitleVisible} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="tabular-nums">
            {segmentCount === 0 ? '0 / 0' : `${segmentPosition + 1} / ${segmentCount}`}
          </span>
          <Badge variant="outline" aria-label={`播放速度 ${rate}x`}>
            {rate}x
          </Badge>
          <Badge variant="outline">{subtitleVisible ? '字幕：开' : '字幕：关'}</Badge>
          <Badge variant="secondary">{isPlaying ? '播放中' : '已暂停'}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="练习控制">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="btn secondary"
            disabled={!canGoPrevious}
            onMouseDown={keepFocus}
            onClick={onPrevious}
            aria-keyshortcuts="ArrowLeft"
          >
            上一句
          </Button>
          <Button
            type="button"
            size="sm"
            className="btn"
            disabled={text === null}
            onMouseDown={keepFocus}
            onClick={onReplay}
            aria-keyshortcuts="Space"
          >
            重播
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="btn secondary"
            disabled={!canGoNext}
            onMouseDown={keepFocus}
            onClick={onNext}
            aria-keyshortcuts="ArrowRight"
          >
            下一句
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="btn secondary"
            onMouseDown={keepFocus}
            onClick={onToggleRate}
            aria-keyshortcuts="S"
          >
            速度 {rate === 1 ? '1x' : '0.75x'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="btn secondary"
            aria-pressed={subtitleVisible}
            onMouseDown={keepFocus}
            onClick={onToggleSubtitle}
            aria-keyshortcuts="H"
          >
            字幕
          </Button>
        </div>
      </div>
    </section>
  )
}
