'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'

/** Player states surfaced to the practice UI. `ready` fires once the player can accept commands. */
export type ShadowingPlayerState =
  | 'ready'
  | 'unstarted'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'cued'

/**
 * The small surface the practice page needs from a video player. Commands issued before the
 * underlying player is ready are queued and replayed once it is.
 */
export interface ShadowingPlayer {
  load: (videoId: string) => void
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
  getCurrentTime: () => number
  setPlaybackRate: (rate: number) => void
  onStateChange: (callback: (state: ShadowingPlayerState) => void) => () => void
  destroy: () => void
}

/** Creates a player that renders inside `container`. Tests inject a fake through the provider. */
export type ShadowingPlayerFactory = (container: HTMLElement) => ShadowingPlayer

// ---------------------------------------------------------------------------
// Minimal YouTube IFrame Player API declarations (only what we use).
// https://developers.google.com/youtube/iframe_api_reference
// ---------------------------------------------------------------------------

interface YouTubePlayerInstance {
  cueVideoById: (videoId: string) => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  pauseVideo: () => void
  getCurrentTime: () => number
  setPlaybackRate: (rate: number) => void
  destroy: () => void
}

interface YouTubePlayerOptions {
  videoId: string
  width?: string | number
  height?: string | number
  playerVars: {
    playsinline: 0 | 1
    rel: 0 | 1
    modestbranding: 0 | 1
    controls: 0 | 1
    cc_load_policy: 0 | 1
  }
  events: {
    onReady: () => void
    onStateChange: (event: { data: number }) => void
  }
}

interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayerInstance
}

type YouTubeWindow = Window & {
  YT?: Partial<YouTubeNamespace>
  onYouTubeIframeAPIReady?: () => void
}

const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'

const youtubeStateByCode: Readonly<Record<number, ShadowingPlayerState>> = {
  [-1]: 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued'
}

let youtubeApiPromise: Promise<YouTubeNamespace> | null = null

const loadYouTubeIframeApi = (): Promise<YouTubeNamespace> => {
  if (youtubeApiPromise !== null) {
    return youtubeApiPromise
  }

  youtubeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const youtubeWindow: YouTubeWindow = window
    const readyNamespace = (): YouTubeNamespace | null => {
      const Player = youtubeWindow.YT?.Player
      return Player === undefined ? null : { Player }
    }

    const existing = readyNamespace()
    if (existing !== null) {
      resolve(existing)
      return
    }

    const previousReady = youtubeWindow.onYouTubeIframeAPIReady
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      const namespace = readyNamespace()
      if (namespace === null) {
        reject(new Error('YouTube IFrame API loaded without YT.Player'))
        return
      }
      resolve(namespace)
    }

    if (document.querySelector(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`) === null) {
      const script = document.createElement('script')
      script.src = YOUTUBE_IFRAME_API_SRC
      script.async = true
      script.addEventListener('error', () => {
        youtubeApiPromise = null
        reject(new Error('Failed to load the YouTube IFrame API'))
      })
      document.head.append(script)
    }
  })

  return youtubeApiPromise
}

/** Production factory backed by the official YouTube IFrame Player API. */
export const createYouTubeShadowingPlayer: ShadowingPlayerFactory = (container) => {
  const listeners = new Set<(state: ShadowingPlayerState) => void>()
  const pendingCommands: Array<(player: YouTubePlayerInstance) => void> = []
  let player: YouTubePlayerInstance | null = null
  let ready = false
  let destroyed = false
  let creating = false
  let mountNode: HTMLDivElement | null = null

  const emit = (state: ShadowingPlayerState) => {
    for (const listener of listeners) {
      listener(state)
    }
  }

  const run = (command: (instance: YouTubePlayerInstance) => void) => {
    if (player !== null && ready) {
      command(player)
      return
    }
    pendingCommands.push(command)
  }

  const create = async (videoId: string) => {
    creating = true
    let youtube: YouTubeNamespace
    try {
      youtube = await loadYouTubeIframeApi()
    } catch {
      // Script blocked or offline: allow a later load() to retry.
      creating = false
      return
    }
    if (destroyed) {
      return
    }
    // YT.Player replaces the element it receives with an iframe, so give it a node that
    // React does not own.
    mountNode = document.createElement('div')
    mountNode.className = 'size-full'
    container.append(mountNode)
    player = new youtube.Player(mountNode, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, cc_load_policy: 0 },
      events: {
        onReady: () => {
          ready = true
          const instance = player
          if (instance !== null) {
            for (const command of pendingCommands.splice(0)) {
              command(instance)
            }
          }
          emit('ready')
        },
        onStateChange: (event) => {
          const state = youtubeStateByCode[event.data]
          if (state !== undefined) {
            emit(state)
          }
        }
      }
    })
  }

  return {
    load: (videoId) => {
      if (destroyed) {
        return
      }
      if (player === null && !creating) {
        void create(videoId)
        return
      }
      run((instance) => instance.cueVideoById(videoId))
    },
    seekTo: (seconds) => run((instance) => instance.seekTo(seconds, true)),
    play: () => run((instance) => instance.playVideo()),
    pause: () => run((instance) => instance.pauseVideo()),
    getCurrentTime: () => (player !== null && ready ? player.getCurrentTime() : 0),
    setPlaybackRate: (rate) => run((instance) => instance.setPlaybackRate(rate)),
    onStateChange: (callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    destroy: () => {
      destroyed = true
      listeners.clear()
      pendingCommands.length = 0
      player?.destroy()
      player = null
      mountNode?.remove()
      mountNode = null
    }
  }
}

const ShadowingPlayerFactoryContext = createContext<ShadowingPlayerFactory>(createYouTubeShadowingPlayer)

interface ShadowingPlayerProviderProps {
  readonly createPlayer: ShadowingPlayerFactory
  readonly children: ReactNode
}

/** Overrides the player factory (tests inject a fake; production uses the default YouTube factory). */
export function ShadowingPlayerProvider({ createPlayer, children }: ShadowingPlayerProviderProps) {
  return (
    <ShadowingPlayerFactoryContext.Provider value={createPlayer}>
      {children}
    </ShadowingPlayerFactoryContext.Provider>
  )
}

export const useShadowingPlayerFactory = (): ShadowingPlayerFactory =>
  useContext(ShadowingPlayerFactoryContext)

/**
 * Creates a player inside the element attached to `containerRef` and loads `videoId`.
 * The player is destroyed when the element unmounts or the video id changes.
 */
export const useShadowingPlayerInstance = (
  videoId: string | null
): { containerRef: (element: HTMLDivElement | null) => void; player: ShadowingPlayer | null } => {
  const createPlayer = useShadowingPlayerFactory()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [player, setPlayer] = useState<ShadowingPlayer | null>(null)

  const containerRef = useCallback((element: HTMLDivElement | null) => {
    setContainer(element)
  }, [])

  useEffect(() => {
    if (container === null || videoId === null) {
      return
    }
    const instance = createPlayer(container)
    instance.load(videoId)
    setPlayer(instance)
    return () => {
      setPlayer(null)
      instance.destroy()
    }
  }, [container, createPlayer, videoId])

  return { containerRef, player }
}
