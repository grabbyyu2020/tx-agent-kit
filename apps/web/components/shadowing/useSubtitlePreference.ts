'use client'

import { useCallback, useSyncExternalStore } from 'react'

export const SUBTITLE_PREFERENCE_STORAGE_KEY = 'shadowing.subtitleVisible'

const listeners = new Set<() => void>()

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const readSubtitleVisible = (): boolean =>
  getStorage()?.getItem(SUBTITLE_PREFERENCE_STORAGE_KEY) !== 'false'

const writeSubtitleVisible = (visible: boolean): void => {
  try {
    getStorage()?.setItem(SUBTITLE_PREFERENCE_STORAGE_KEY, String(visible))
  } catch {
    // Storage full or blocked: the choice simply is not remembered.
  }
  for (const listener of listeners) {
    listener()
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SUBTITLE_PREFERENCE_STORAGE_KEY || event.key === null) {
      listener()
    }
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

const getServerSnapshot = (): boolean => true

/** English subtitle visibility: visible by default, remembered in localStorage [INV-SHADOW-015]. */
export const useSubtitlePreference = (): {
  subtitleVisible: boolean
  setSubtitleVisible: (visible: boolean) => void
  toggleSubtitle: () => void
} => {
  const subtitleVisible = useSyncExternalStore(subscribe, readSubtitleVisible, getServerSnapshot)

  const setSubtitleVisible = useCallback((visible: boolean) => {
    writeSubtitleVisible(visible)
  }, [])

  const toggleSubtitle = useCallback(() => {
    writeSubtitleVisible(!readSubtitleVisible())
  }, [])

  return { subtitleVisible, setSubtitleVisible, toggleSubtitle }
}
