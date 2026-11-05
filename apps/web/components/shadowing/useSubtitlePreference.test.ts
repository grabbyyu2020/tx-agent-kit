// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SUBTITLE_PREFERENCE_STORAGE_KEY, useSubtitlePreference } from './useSubtitlePreference'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('useSubtitlePreference', () => {
  it('shows the subtitle by default [INV-SHADOW-015]', () => {
    const { result } = renderHook(() => useSubtitlePreference())
    expect(SUBTITLE_PREFERENCE_STORAGE_KEY).toBe('shadowing.subtitleVisible')
    expect(result.current.subtitleVisible).toBe(true)
  })

  it('persists the hidden choice across visits [INV-SHADOW-015]', () => {
    const first = renderHook(() => useSubtitlePreference())
    act(() => {
      first.result.current.toggleSubtitle()
    })
    expect(first.result.current.subtitleVisible).toBe(false)
    expect(window.localStorage.getItem('shadowing.subtitleVisible')).toBe('false')
    first.unmount()

    const second = renderHook(() => useSubtitlePreference())
    expect(second.result.current.subtitleVisible).toBe(false)

    act(() => {
      second.result.current.setSubtitleVisible(true)
    })
    expect(second.result.current.subtitleVisible).toBe(true)
    expect(window.localStorage.getItem('shadowing.subtitleVisible')).toBe('true')
  })
})
