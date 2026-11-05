// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CurrentSegmentCaption } from './CurrentSegmentCaption'

afterEach(() => {
  cleanup()
})

describe('CurrentSegmentCaption', () => {
  it('shows the caption only when subtitles are visible and wires the controls', () => {
    const onNext = vi.fn<() => void>()
    const props = {
      text: 'Hello there.',
      rate: 1 as const,
      isPlaying: false,
      segmentPosition: 0,
      segmentCount: 2,
      canGoPrevious: false,
      canGoNext: true,
      onPrevious: () => undefined,
      onReplay: () => undefined,
      onNext,
      onToggleRate: () => undefined,
      onToggleSubtitle: () => undefined
    }
    const { rerender } = render(<CurrentSegmentCaption {...props} subtitleVisible />)
    expect(screen.getByText('Hello there.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '下一句' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '上一句' }).hasAttribute('disabled')).toBe(true)

    rerender(<CurrentSegmentCaption {...props} subtitleVisible={false} />)
    expect(screen.queryByText('Hello there.')).toBeNull()
  })
})
