import React from 'react'
import { randomUUID } from 'node:crypto'
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { createUser, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ShadowingPlayerProvider,
  type ShadowingPlayer,
  type ShadowingPlayerFactory,
  type ShadowingPlayerState
} from '@/components/shadowing/ShadowingPlayerContext'
import { SUBTITLE_PREFERENCE_STORAGE_KEY } from '@/components/shadowing/useSubtitlePreference'
import { shadowingGetVideo } from '@/lib/api/generated/shadowing/shadowing'
import { writeAuthToken } from '@/lib/auth-token'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/integration/test-utils'
import ShadowingPracticePage from './page'

// ---------------------------------------------------------------------------
// Fake player: records commands; tests move `currentTime` to simulate playback.
// ---------------------------------------------------------------------------

interface FakePlayer extends ShadowingPlayer {
  currentTime: number
  readonly container: HTMLElement
  readonly loaded: string[]
  readonly seeks: number[]
  readonly rates: number[]
  playCount: number
  pauseCount: number
}

const createFakePlayerFactory = (): { factory: ShadowingPlayerFactory; players: FakePlayer[] } => {
  const players: FakePlayer[] = []
  const factory: ShadowingPlayerFactory = (container) => {
    const listeners = new Set<(state: ShadowingPlayerState) => void>()
    const emit = (state: ShadowingPlayerState) => {
      for (const listener of listeners) {
        listener(state)
      }
    }
    const player: FakePlayer = {
      currentTime: 0,
      container,
      loaded: [],
      seeks: [],
      rates: [],
      playCount: 0,
      pauseCount: 0,
      load: (videoId) => {
        player.loaded.push(videoId)
      },
      seekTo: (seconds) => {
        player.seeks.push(seconds)
        player.currentTime = seconds
      },
      play: () => {
        player.playCount += 1
        emit('playing')
      },
      pause: () => {
        player.pauseCount += 1
        emit('paused')
      },
      getCurrentTime: () => player.currentTime,
      setPlaybackRate: (rate) => {
        player.rates.push(rate)
      },
      onStateChange: (callback) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      },
      destroy: () => {
        listeners.clear()
      }
    }
    players.push(player)
    return player
  }
  return { factory, players }
}

// ---------------------------------------------------------------------------
// Seed data: 3 sentences, 4 segments. Sentence 0 → segments 0,1; sentence 1 →
// segment 2; sentence 2 (pending, batch 1) → segment 3.
// ---------------------------------------------------------------------------

const segmentsSeed = [
  { segmentIndex: 0, sentenceIndex: 0, text: 'First half of the opener,', startMs: 0, endMs: 1500 },
  { segmentIndex: 1, sentenceIndex: 0, text: 'second half of the opener.', startMs: 1500, endMs: 3000 },
  { segmentIndex: 2, sentenceIndex: 1, text: 'The middle sentence is short.', startMs: 3000, endMs: 5000 },
  { segmentIndex: 3, sentenceIndex: 2, text: 'A pending sentence closes it.', startMs: 5000, endMs: 7000 }
] as const

const sentencesSeed = [
  {
    text: 'First half of the opener, second half of the opener.',
    batchIndex: 0,
    status: 'ready',
    explanation: { meaning: '开场白的意思', keyExpressions: [{ expression: 'opener', explanation: '开场' }], toneAndContext: '轻松' }
  },
  {
    text: 'The middle sentence is short.',
    batchIndex: 0,
    status: 'ready',
    explanation: { meaning: '中间这句很短', keyExpressions: [], toneAndContext: '中性' }
  },
  { text: 'A pending sentence closes it.', batchIndex: 1, status: 'pending', explanation: null }
] as const

const seedPracticeVideo = async (
  factoryContext: ApiFactoryContext,
  userId: string,
  lastSegmentIndex = 0
): Promise<{ id: string; youtubeVideoId: string }> => {
  const youtubeVideoId = randomUUID().replaceAll('-', '').slice(0, 11)
  const id = await factoryContext.testContext.withSchemaClient(async (client) => {
    const video = await client.query<{ id: string }>(
      `INSERT INTO shadowing_videos (user_id, youtube_video_id, title, duration_seconds, status, sentence_count, last_segment_index)
       VALUES ($1, $2, 'Practice Talk', 7, 'ready', $3, $4)
       RETURNING id`,
      [userId, youtubeVideoId, sentencesSeed.length, lastSegmentIndex]
    )
    const videoId = video.rows[0]?.id
    if (videoId === undefined) {
      throw new Error('Failed to seed shadowing video')
    }
    for (const [sentenceIndex, sentence] of sentencesSeed.entries()) {
      const segments = segmentsSeed.filter((segment) => segment.sentenceIndex === sentenceIndex)
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO shadowing_sentences (video_id, sentence_index, batch_index, text, start_ms, end_ms, explanation, explanation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id`,
        [
          videoId,
          sentenceIndex,
          sentence.batchIndex,
          sentence.text,
          segments[0]?.startMs ?? 0,
          segments.at(-1)?.endMs ?? 0,
          sentence.explanation === null ? null : JSON.stringify(sentence.explanation),
          sentence.status
        ]
      )
      for (const segment of segments) {
        await client.query(
          `INSERT INTO shadowing_segments (video_id, sentence_id, segment_index, sentence_index, text, start_ms, end_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [videoId, inserted.rows[0]?.id, segment.segmentIndex, segment.sentenceIndex, segment.text, segment.startMs, segment.endMs]
        )
      }
    }
    return videoId
  })
  return { id, youtubeVideoId }
}

const readExplanationRequestedAt = async (
  factoryContext: ApiFactoryContext,
  videoId: string,
  sentenceIndex: number
): Promise<Date | null> =>
  factoryContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ explanation_requested_at: Date | null }>(
      'SELECT explanation_requested_at FROM shadowing_sentences WHERE video_id = $1 AND sentence_index = $2',
      [videoId, sentenceIndex]
    )
    return result.rows[0]?.explanation_requested_at ?? null
  })

const renderPracticePage = (videoId: string, factory: ShadowingPlayerFactory) =>
  renderWithProviders(
    <ShadowingPlayerProvider createPlayer={factory}>
      <PathParamsContext.Provider value={{ videoId }}>
        <ShadowingPracticePage />
      </PathParamsContext.Provider>
    </ShadowingPlayerProvider>
  )

const caption = (): HTMLElement => screen.getByTestId('shadowing-current-caption')

const explanationPanel = (): HTMLElement => screen.getByTestId('shadowing-explanation-panel')

/** Renders the page for a fresh learner and waits until the player is mounted. */
const setupPracticePage = async (lastSegmentIndex = 0) => {
  const factoryContext = createWebFactoryContext()
  const learner = await createUser(factoryContext, { name: 'Shadowing Practice Learner' })
  const video = await seedPracticeVideo(factoryContext, learner.user.id, lastSegmentIndex)
  const { factory, players } = createFakePlayerFactory()
  writeAuthToken(learner.token)
  const rendered = renderPracticePage(video.id, factory)
  await waitFor(() => {
    expect(players).toHaveLength(1)
  })
  const player = players[0]
  if (player === undefined) {
    throw new Error('Player was not created')
  }
  // The sentence list may show the same text, so wait inside the caption.
  await within(await screen.findByTestId('shadowing-current-caption')).findByText(
    segmentsSeed[lastSegmentIndex]?.text ?? ''
  )
  return { factoryContext, learner, video, factory, players, player, rendered }
}

describe('ShadowingPracticePage integration', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
  })

  it('mounts the YouTube IFrame player for the video [INV-SHADOW-014]', async () => {
    const { player, video } = await setupPracticePage()

    expect(player.loaded).toEqual([video.youtubeVideoId])
    expect(player.container).toBeInstanceOf(HTMLDivElement)
    expect(screen.getByTestId('shadowing-player')).toBe(player.container)
    // Nothing plays until the learner asks for it.
    expect(player.playCount).toBe(0)
    expect(within(caption()).getByText('First half of the opener,')).toBeInTheDocument()
  })

  it('shows the explanation after pausing at the segment end [INV-SHADOW-014]', async () => {
    const { player } = await setupPracticePage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '重播' }))
    expect(player.seeks.at(-1)).toBe(0)
    expect(player.playCount).toBe(1)
    await waitFor(() => {
      expect(within(explanationPanel()).getByText('跟读中… 这一段结束后显示解读。')).toBeInTheDocument()
    })
    expect(within(explanationPanel()).queryByText('开场白的意思')).toBeNull()

    // Playback reaches end (1500 ms) + 200 ms padding.
    player.currentTime = 1.7
    await waitFor(() => {
      expect(player.pauseCount).toBe(1)
    })
    expect(await within(explanationPanel()).findByText('开场白的意思')).toBeInTheDocument()
    expect(within(explanationPanel()).getByText('opener')).toBeInTheDocument()

    // It stays paused on the same segment: no automatic play or advance.
    expect(player.playCount).toBe(1)
    expect(within(caption()).getByText('First half of the opener,')).toBeInTheDocument()
  })

  it('keyboard shortcuts [INV-SHADOW-015]', async () => {
    const { player } = await setupPracticePage()
    const user = userEvent.setup()

    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(within(caption()).getByText('second half of the opener.')).toBeInTheDocument()
    })
    expect(player.seeks.at(-1)).toBe(1.5)
    expect(player.playCount).toBe(1)

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => {
      expect(within(caption()).getByText('First half of the opener,')).toBeInTheDocument()
    })
    expect(player.seeks.at(-1)).toBe(0)

    player.seeks.length = 0
    await user.keyboard(' ')
    expect(player.seeks).toEqual([0])
    expect(player.playCount).toBe(3)

    await user.keyboard('s')
    await waitFor(() => {
      expect(player.rates.at(-1)).toBe(0.75)
    })
    expect(screen.getByRole('button', { name: '速度 0.75x' })).toBeInTheDocument()
    await user.keyboard('s')
    await waitFor(() => {
      expect(player.rates.at(-1)).toBe(1)
    })

    await user.keyboard('h')
    await waitFor(() => {
      expect(within(caption()).getByText('字幕已隐藏（按 H 显示）')).toBeInTheDocument()
    })
    await user.keyboard('h')
    await waitFor(() => {
      expect(within(caption()).getByText('First half of the opener,')).toBeInTheDocument()
    })
  })

  it('remembers subtitle visibility [INV-SHADOW-015]', async () => {
    const { rendered, video, factory } = await setupPracticePage()
    const user = userEvent.setup()

    await user.keyboard('h')
    await waitFor(() => {
      expect(within(caption()).getByText('字幕已隐藏（按 H 显示）')).toBeInTheDocument()
    })
    expect(globalThis.localStorage.getItem(SUBTITLE_PREFERENCE_STORAGE_KEY)).toBe('false')

    rendered.unmount()
    renderPracticePage(video.id, factory)

    expect(await screen.findByText('字幕已隐藏（按 H 显示）')).toBeInTheDocument()
    expect(screen.queryByText('First half of the opener,')).toBeNull()
  })

  it('selecting a sentence seeks to its first segment [INV-SHADOW-015]', async () => {
    const { player } = await setupPracticePage()
    const user = userEvent.setup()

    const sentenceList = screen.getByRole('navigation', { name: '句子列表' })
    await user.click(within(sentenceList).getByText('The middle sentence is short.'))

    expect(player.seeks.at(-1)).toBe(3)
    expect(player.playCount).toBe(1)
    await waitFor(() => {
      expect(within(caption()).getByText('The middle sentence is short.')).toBeInTheDocument()
    })
    expect(
      within(sentenceList).getByText('The middle sentence is short.').closest('button')
    ).toHaveAttribute('aria-current', 'true')
  })

  it('resumes at the last practiced segment [INV-SHADOW-016]', async () => {
    const { player } = await setupPracticePage(2)
    const user = userEvent.setup()

    expect(within(caption()).getByText('The middle sentence is short.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '当前句子' })).getByText('3 / 4')).toBeInTheDocument()
    expect(player.playCount).toBe(0)

    await user.click(screen.getByRole('button', { name: '重播' }))
    expect(player.seeks.at(-1)).toBe(3)
  })

  it('saves progress when the current segment changes [INV-SHADOW-016]', async () => {
    const { video } = await setupPracticePage()
    const user = userEvent.setup()

    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')

    await waitFor(
      async () => {
        const detail = await shadowingGetVideo(video.id)
        expect(detail.video.lastSegmentIndex).toBe(2)
      },
      { timeout: 10_000, interval: 250 }
    )
  })

  it('prioritises a pending sentence when it becomes current [AC-SHADOW-007]', async () => {
    const { factoryContext, video } = await setupPracticePage()
    const user = userEvent.setup()

    expect(await readExplanationRequestedAt(factoryContext, video.id, 2)).toBeNull()

    const sentenceList = screen.getByRole('navigation', { name: '句子列表' })
    await user.click(within(sentenceList).getByText('A pending sentence closes it.'))

    await waitFor(async () => {
      expect(await readExplanationRequestedAt(factoryContext, video.id, 2)).not.toBeNull()
    })
    // Ready sentences are never prioritised.
    expect(await readExplanationRequestedAt(factoryContext, video.id, 0)).toBeNull()
  })

  it('shows the import status instead of the player while the video is not ready', async () => {
    const factoryContext = createWebFactoryContext()
    const learner = await createUser(factoryContext, { name: 'Shadowing Not Ready' })
    const youtubeVideoId = randomUUID().replaceAll('-', '').slice(0, 11)
    const videoId = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO shadowing_videos (user_id, youtube_video_id, title, status, failure_reason, failure_message)
         VALUES ($1, $2, 'Captionless Talk', 'failed', 'no_captions', 'Video has no English captions')
         RETURNING id`,
        [learner.user.id, youtubeVideoId]
      )
      return result.rows[0]?.id ?? ''
    })
    const factory = vi.fn<ShadowingPlayerFactory>()

    writeAuthToken(learner.token)
    renderPracticePage(videoId, factory)

    expect(await screen.findByText('不支持：该视频没有英文字幕')).toBeInTheDocument()
    expect(screen.queryByTestId('shadowing-player')).toBeNull()
    expect(factory).not.toHaveBeenCalled()
  })
})
