// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShadowingGetVideo200SegmentsItem } from '@/lib/api/generated/schemas'
import type { ShadowingPlayer, ShadowingPlayerState } from './ShadowingPlayerContext'
import {
  findFirstSegmentIndexForSentence,
  nextSegmentIndex,
  previousSegmentIndex,
  shouldPauseAtSegmentEnd,
  toggleShadowingRate
} from './shadowingSegmentLogic'
import { useYouTubeSegmentPlayer } from './useYouTubeSegmentPlayer'

interface FakePlayer extends ShadowingPlayer {
  currentTime: number
  readonly seekTo: ReturnType<typeof vi.fn<(seconds: number) => void>>
  readonly play: ReturnType<typeof vi.fn<() => void>>
  readonly pause: ReturnType<typeof vi.fn<() => void>>
  readonly setPlaybackRate: ReturnType<typeof vi.fn<(rate: number) => void>>
  emit: (state: ShadowingPlayerState) => void
}

const createFakePlayer = (): FakePlayer => {
  const listeners = new Set<(state: ShadowingPlayerState) => void>()
  const fake: FakePlayer = {
    currentTime: 0,
    load: vi.fn<(videoId: string) => void>(),
    seekTo: vi.fn<(seconds: number) => void>((seconds) => {
      fake.currentTime = seconds
    }),
    play: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    getCurrentTime: () => fake.currentTime,
    setPlaybackRate: vi.fn<(rate: number) => void>(),
    onStateChange: (callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    destroy: vi.fn<() => void>(),
    emit: (state) => {
      for (const listener of listeners) {
        listener(state)
      }
    }
  }
  return fake
}

const segments: ReadonlyArray<ShadowingGetVideo200SegmentsItem> = [
  { segmentIndex: 0, sentenceIndex: 0, text: 'Hello there.', startMs: 1000, endMs: 2000 },
  { segmentIndex: 1, sentenceIndex: 1, text: 'How are you doing today,', startMs: 2100, endMs: 3500 },
  { segmentIndex: 2, sentenceIndex: 1, text: 'my friend?', startMs: 3600, endMs: 4200 }
]

interface HarnessProps {
  readonly currentSegmentIndex: number
}

const renderSegmentPlayer = (player: FakePlayer, initialIndex = 0) => {
  const onSegmentEnd = vi.fn<(segmentIndex: number) => void>()
  const onCurrentSegmentChange = vi.fn<(segmentIndex: number) => void>()
  const view = renderHook(
    ({ currentSegmentIndex }: HarnessProps) =>
      useYouTubeSegmentPlayer({
        player,
        segments,
        currentSegmentIndex,
        onSegmentEnd,
        onCurrentSegmentChange
      }),
    { initialProps: { currentSegmentIndex: initialIndex } }
  )
  return { ...view, onSegmentEnd, onCurrentSegmentChange }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('shadowingSegmentLogic', () => {
  it('pauses only once currentTime reaches end + padding [INV-SHADOW-014]', () => {
    const segment = { startMs: 1000, endMs: 2000 }
    expect(shouldPauseAtSegmentEnd(2.199, segment)).toBe(false)
    expect(shouldPauseAtSegmentEnd(2.2, segment)).toBe(true)
    expect(shouldPauseAtSegmentEnd(5, segment)).toBe(true)
  })

  it('bounds next/previous indexes and maps a sentence to its first segment', () => {
    expect(nextSegmentIndex(0, 3)).toBe(1)
    expect(nextSegmentIndex(2, 3)).toBeNull()
    expect(previousSegmentIndex(1, 3)).toBe(0)
    expect(previousSegmentIndex(0, 3)).toBeNull()
    expect(nextSegmentIndex(0, 0)).toBeNull()
    expect(findFirstSegmentIndexForSentence(segments, 1)).toBe(1)
    expect(findFirstSegmentIndexForSentence(segments, 9)).toBeNull()
  })

  it('toggles rate between 1 and 0.75', () => {
    expect(toggleShadowingRate(1)).toBe(0.75)
    expect(toggleShadowingRate(0.75)).toBe(1)
  })
})

describe('useYouTubeSegmentPlayer', () => {
  it('playSegment seeks to the segment start and plays', () => {
    const player = createFakePlayer()
    const { result } = renderSegmentPlayer(player)

    act(() => {
      result.current.playSegment(0)
    })

    expect(player.seekTo).toHaveBeenLastCalledWith(1)
    expect(player.play).toHaveBeenCalledTimes(1)
    expect(result.current.isPlaying).toBe(true)
  })

  it('keeps playing at end + 199 ms and pauses at end + 200 ms [INV-SHADOW-014]', () => {
    const player = createFakePlayer()
    const { result, onSegmentEnd } = renderSegmentPlayer(player)

    act(() => {
      result.current.playSegment(0)
    })

    player.currentTime = 2.199
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(player.pause).not.toHaveBeenCalled()
    expect(onSegmentEnd).not.toHaveBeenCalled()
    expect(result.current.isPlaying).toBe(true)

    player.currentTime = 2.2
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(onSegmentEnd).toHaveBeenCalledWith(0)
    expect(result.current.isPlaying).toBe(false)
  })

  it('stays paused after the segment end and calls onSegmentEnd once [INV-SHADOW-014]', () => {
    const player = createFakePlayer()
    const { result, onSegmentEnd } = renderSegmentPlayer(player)

    act(() => {
      result.current.playSegment(0)
    })
    player.currentTime = 2.3
    act(() => {
      vi.advanceTimersByTime(60)
    })
    act(() => {
      player.emit('paused')
    })

    player.currentTime = 2.5
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(player.play).toHaveBeenCalledTimes(1)
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(onSegmentEnd).toHaveBeenCalledTimes(1)
    expect(result.current.isPlaying).toBe(false)
  })

  it('treats the video ending before the padding as the segment end', () => {
    const player = createFakePlayer()
    const { result, onSegmentEnd } = renderSegmentPlayer(player, 2)

    act(() => {
      result.current.playSegment(2)
    })
    act(() => {
      player.emit('ended')
    })

    expect(onSegmentEnd).toHaveBeenCalledTimes(1)
    expect(onSegmentEnd).toHaveBeenCalledWith(2)
    expect(result.current.isPlaying).toBe(false)
  })

  it('replay seeks back to the current segment start and plays again', () => {
    const player = createFakePlayer()
    const { result, onCurrentSegmentChange } = renderSegmentPlayer(player, 1)

    act(() => {
      result.current.replay()
    })
    player.currentTime = 3.0
    act(() => {
      result.current.replay()
    })

    expect(player.seekTo).toHaveBeenNthCalledWith(1, 2.1)
    expect(player.seekTo).toHaveBeenNthCalledWith(2, 2.1)
    expect(player.play).toHaveBeenCalledTimes(2)
    expect(onCurrentSegmentChange).not.toHaveBeenCalled()
  })

  it('next/previous play the neighbouring segment and are bounded at both ends', () => {
    const player = createFakePlayer()
    const { result, rerender, onCurrentSegmentChange } = renderSegmentPlayer(player, 0)

    act(() => {
      result.current.previous()
    })
    expect(player.seekTo).not.toHaveBeenCalled()
    expect(onCurrentSegmentChange).not.toHaveBeenCalled()
    expect(result.current.canGoPrevious).toBe(false)

    act(() => {
      result.current.next()
    })
    expect(onCurrentSegmentChange).toHaveBeenLastCalledWith(1)
    expect(player.seekTo).toHaveBeenLastCalledWith(2.1)

    rerender({ currentSegmentIndex: 2 })
    expect(result.current.canGoNext).toBe(false)
    act(() => {
      result.current.next()
    })
    expect(player.seekTo).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.previous()
    })
    expect(onCurrentSegmentChange).toHaveBeenLastCalledWith(1)
    expect(player.seekTo).toHaveBeenLastCalledWith(2.1)
    expect(player.play).toHaveBeenCalledTimes(2)
  })

  it('toggles the playback rate between 1x and 0.75x', () => {
    const player = createFakePlayer()
    const { result } = renderSegmentPlayer(player)

    expect(result.current.rate).toBe(1)
    act(() => {
      result.current.toggleRate()
    })
    expect(result.current.rate).toBe(0.75)
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(0.75)

    act(() => {
      result.current.toggleRate()
    })
    expect(result.current.rate).toBe(1)
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1)
  })

  it('does nothing without a player', () => {
    const onSegmentEnd = vi.fn<(segmentIndex: number) => void>()
    const { result } = renderHook(() =>
      useYouTubeSegmentPlayer({
        player: null,
        segments,
        currentSegmentIndex: 0,
        onSegmentEnd,
        onCurrentSegmentChange: () => undefined
      })
    )

    act(() => {
      result.current.replay()
      vi.advanceTimersByTime(500)
    })
    expect(result.current.isPlaying).toBe(false)
    expect(onSegmentEnd).not.toHaveBeenCalled()
  })
})
