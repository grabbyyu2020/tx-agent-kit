'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShadowingPlayer } from './ShadowingPlayerContext'
import {
  isValidSegmentIndex,
  nextSegmentIndex,
  previousSegmentIndex,
  shouldPauseAtSegmentEnd,
  toggleShadowingRate,
  type ShadowingPlaybackRate
} from './shadowingSegmentLogic'

const POLL_INTERVAL_MS = 50

export interface ShadowingSegment {
  readonly startMs: number
  readonly endMs: number
}

export interface UseYouTubeSegmentPlayerOptions {
  readonly player: ShadowingPlayer | null
  /** Segments ordered by playback; indexes below are positions in this array. */
  readonly segments: ReadonlyArray<ShadowingSegment>
  readonly currentSegmentIndex: number
  /** Called once each time playback pauses at the end of a segment. */
  readonly onSegmentEnd: (segmentIndex: number) => void
  /** Called when next/previous/playSegment move to a different segment. */
  readonly onCurrentSegmentChange: (segmentIndex: number) => void
}

export interface UseYouTubeSegmentPlayerResult {
  readonly isPlaying: boolean
  readonly rate: ShadowingPlaybackRate
  readonly canGoPrevious: boolean
  readonly canGoNext: boolean
  readonly playSegment: (segmentIndex: number) => void
  readonly replay: () => void
  readonly next: () => void
  readonly previous: () => void
  readonly toggleRate: () => void
}

/**
 * Plays one practice segment at a time and pauses once playback reaches the segment end plus
 * SHADOWING_PAUSE_PADDING_MS. It never resumes playback on its own [INV-SHADOW-014].
 */
export const useYouTubeSegmentPlayer = ({
  player,
  segments,
  currentSegmentIndex,
  onSegmentEnd,
  onCurrentSegmentChange
}: UseYouTubeSegmentPlayerOptions): UseYouTubeSegmentPlayerResult => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [rate, setRate] = useState<ShadowingPlaybackRate>(1)

  const playerRef = useRef(player)
  const segmentsRef = useRef(segments)
  const onSegmentEndRef = useRef(onSegmentEnd)
  const onCurrentSegmentChangeRef = useRef(onCurrentSegmentChange)
  const currentSegmentIndexRef = useRef(currentSegmentIndex)
  const activeSegmentRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    playerRef.current = player
    segmentsRef.current = segments
    onSegmentEndRef.current = onSegmentEnd
    onCurrentSegmentChangeRef.current = onCurrentSegmentChange
    currentSegmentIndexRef.current = currentSegmentIndex
  })

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const finishActiveSegment = useCallback(
    (pausePlayer: boolean) => {
      const segmentIndex = activeSegmentRef.current
      if (segmentIndex === null) {
        return
      }
      activeSegmentRef.current = null
      stopPolling()
      if (pausePlayer) {
        playerRef.current?.pause()
      }
      setIsPlaying(false)
      onSegmentEndRef.current(segmentIndex)
    },
    [stopPolling]
  )

  const tick = useCallback(() => {
    const segmentIndex = activeSegmentRef.current
    const activePlayer = playerRef.current
    const segment = segmentIndex === null ? undefined : segmentsRef.current[segmentIndex]
    if (activePlayer === null || segment === undefined) {
      activeSegmentRef.current = null
      stopPolling()
      return
    }
    if (shouldPauseAtSegmentEnd(activePlayer.getCurrentTime(), segment)) {
      finishActiveSegment(true)
    }
  }, [finishActiveSegment, stopPolling])

  const playSegment = useCallback(
    (segmentIndex: number) => {
      const activePlayer = playerRef.current
      const segment = isValidSegmentIndex(segmentIndex, segmentsRef.current.length)
        ? segmentsRef.current[segmentIndex]
        : undefined
      if (activePlayer === null || segment === undefined) {
        return
      }
      stopPolling()
      activeSegmentRef.current = segmentIndex
      if (segmentIndex !== currentSegmentIndexRef.current) {
        currentSegmentIndexRef.current = segmentIndex
        onCurrentSegmentChangeRef.current(segmentIndex)
      }
      activePlayer.seekTo(segment.startMs / 1000)
      activePlayer.play()
      setIsPlaying(true)
      intervalRef.current = setInterval(tick, POLL_INTERVAL_MS)
    },
    [stopPolling, tick]
  )

  const replay = useCallback(() => {
    playSegment(currentSegmentIndexRef.current)
  }, [playSegment])

  const next = useCallback(() => {
    const target = nextSegmentIndex(currentSegmentIndexRef.current, segmentsRef.current.length)
    if (target !== null) {
      playSegment(target)
    }
  }, [playSegment])

  const previous = useCallback(() => {
    const target = previousSegmentIndex(currentSegmentIndexRef.current, segmentsRef.current.length)
    if (target !== null) {
      playSegment(target)
    }
  }, [playSegment])

  const toggleRate = useCallback(() => {
    setRate(toggleShadowingRate)
  }, [])

  useEffect(() => {
    player?.setPlaybackRate(rate)
  }, [player, rate])

  useEffect(() => {
    if (player === null) {
      return
    }
    const unsubscribe = player.onStateChange((state) => {
      if (state === 'ended') {
        // The video ended before end + padding (last segment): treat it as the segment end.
        finishActiveSegment(false)
        return
      }
      if (state === 'playing') {
        setIsPlaying(true)
      } else if (state === 'paused') {
        setIsPlaying(false)
      }
    })
    return () => {
      unsubscribe()
      activeSegmentRef.current = null
      stopPolling()
      setIsPlaying(false)
    }
  }, [finishActiveSegment, player, stopPolling])

  return {
    isPlaying,
    rate,
    canGoPrevious: previousSegmentIndex(currentSegmentIndex, segments.length) !== null,
    canGoNext: nextSegmentIndex(currentSegmentIndex, segments.length) !== null,
    playSegment,
    replay,
    next,
    previous,
    toggleRate
  }
}
