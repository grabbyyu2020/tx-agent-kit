'use client'

import { useEffect, useRef } from 'react'

export type ShadowingShortcutAction = 'replay' | 'next' | 'previous' | 'toggleRate' | 'toggleSubtitle'

export interface UseShadowingShortcutsOptions {
  readonly onReplay: () => void
  readonly onNext: () => void
  readonly onPrevious: () => void
  readonly onToggleRate: () => void
  readonly onToggleSubtitle: () => void
  /** Defaults to true. */
  readonly enabled?: boolean
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  ) {
    return true
  }
  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

const isButtonLikeTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('button, [role="button"], a[href]') !== null

/** Maps a keydown event to a practice action, or null when it should be left alone [INV-SHADOW-015]. */
export const resolveShadowingShortcut = (event: KeyboardEvent): ShadowingShortcutAction | null => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || event.repeat) {
    return null
  }
  if (isTypingTarget(event.target)) {
    return null
  }
  if (event.key === ' ' || event.code === 'Space') {
    // Space on a focused button activates that button; do not hijack it.
    return isButtonLikeTarget(event.target) ? null : 'replay'
  }
  switch (event.key) {
    case 'ArrowRight':
      return 'next'
    case 'ArrowLeft':
      return 'previous'
    case 's':
    case 'S':
      return 'toggleRate'
    case 'h':
    case 'H':
      return 'toggleSubtitle'
    default:
      return null
  }
}

/** Space replays, ArrowRight/ArrowLeft move between segments, S toggles speed, H toggles the subtitle. */
export const useShadowingShortcuts = (options: UseShadowingShortcutsOptions): void => {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const enabled = options.enabled ?? true

  useEffect(() => {
    if (!enabled) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveShadowingShortcut(event)
      if (action === null) {
        return
      }
      event.preventDefault()
      const current = optionsRef.current
      switch (action) {
        case 'replay':
          current.onReplay()
          break
        case 'next':
          current.onNext()
          break
        case 'previous':
          current.onPrevious()
          break
        case 'toggleRate':
          current.onToggleRate()
          break
        case 'toggleSubtitle':
          current.onToggleSubtitle()
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled])
}
