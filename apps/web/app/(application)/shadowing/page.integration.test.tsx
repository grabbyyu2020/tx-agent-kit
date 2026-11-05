import React from 'react'
import { randomUUID } from 'node:crypto'
import { within } from '@testing-library/react'
import { createUser, type ApiFactoryContext } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { writeAuthToken } from '@/lib/auth-token'
import { createWebFactoryContext } from '@/integration/support/web-integration-context'
import { readIntegrationRouterLocation } from '@/integration/support/next-router-context'
import { renderWithProviders, screen, userEvent, waitFor } from '@/integration/test-utils'
import ShadowingLibraryPage from './page'

type VideoStatus = 'importing' | 'explaining' | 'ready' | 'failed'
type FailureReason = 'no_captions' | 'not_embeddable' | 'import_error'

interface SeedVideoInput {
  readonly title?: string
  readonly status: VideoStatus
  readonly durationSeconds?: number | null
  readonly failureReason?: FailureReason
  readonly failureMessage?: string
  /** One entry per sentence: true when its explanation is ready. */
  readonly sentences?: ReadonlyArray<boolean>
}

const newYoutubeId = (): string => randomUUID().replaceAll('-', '').slice(0, 11)

const sampleExplanation = {
  meaning: '意思',
  keyExpressions: [],
  toneAndContext: '语气'
}

const seedVideo = async (
  factoryContext: ApiFactoryContext,
  userId: string,
  input: SeedVideoInput
): Promise<{ id: string; youtubeVideoId: string }> => {
  const youtubeVideoId = newYoutubeId()
  const sentences = input.sentences ?? []
  const id = await factoryContext.testContext.withSchemaClient(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO shadowing_videos
         (user_id, youtube_video_id, title, thumbnail_url, duration_seconds, status, failure_reason, failure_message, sentence_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        youtubeVideoId,
        input.title ?? '',
        `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`,
        input.durationSeconds ?? null,
        input.status,
        input.failureReason ?? null,
        input.failureMessage ?? null,
        sentences.length
      ]
    )
    const videoId = inserted.rows[0]?.id
    if (videoId === undefined) {
      throw new Error('Failed to seed shadowing video')
    }
    for (const [index, ready] of sentences.entries()) {
      await client.query(
        `INSERT INTO shadowing_sentences (video_id, sentence_index, batch_index, text, start_ms, end_ms, explanation, explanation_status)
         VALUES ($1, $2, 0, $3, $4, $5, $6::jsonb, $7)`,
        [
          videoId,
          index,
          `Sentence ${index}.`,
          index * 1000,
          index * 1000 + 900,
          ready ? JSON.stringify(sampleExplanation) : null,
          ready ? 'ready' : 'pending'
        ]
      )
    }
    return videoId
  })
  return { id, youtubeVideoId }
}

const readVideoStatus = async (factoryContext: ApiFactoryContext, videoId: string): Promise<string | null> =>
  factoryContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ status: string }>(
      'SELECT status FROM shadowing_videos WHERE id = $1',
      [videoId]
    )
    return result.rows[0]?.status ?? null
  })

const countUserVideos = async (factoryContext: ApiFactoryContext, userId: string): Promise<number> =>
  factoryContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM shadowing_videos WHERE user_id = $1',
      [userId]
    )
    return Number(result.rows[0]?.count ?? 0)
  })

/** Waits for the video card containing `text` (the same text may also appear outside cards). */
const findCard = (text: string): Promise<HTMLElement> =>
  waitFor(() => {
    const card = screen
      .queryAllByTestId('shadowing-video-card')
      .find((candidate) => within(candidate).queryByText(text) !== null)
    if (card === undefined) {
      throw new Error(`No video card contains "${text}"`)
    }
    return card
  })

describe('ShadowingLibraryPage integration', () => {
  it('lists videos with status and progress [INV-SHADOW-016]', async () => {
    const factoryContext = createWebFactoryContext()
    const learner = await createUser(factoryContext, { name: 'Shadowing Learner' })
    const otherUser = await createUser(factoryContext, { name: 'Shadowing Other' })

    const ready = await seedVideo(factoryContext, learner.user.id, {
      title: 'Ready Talk',
      status: 'ready',
      durationSeconds: 125,
      sentences: [true, true, false]
    })
    await seedVideo(factoryContext, learner.user.id, { status: 'importing' })
    await seedVideo(factoryContext, learner.user.id, {
      title: 'Explaining Talk',
      status: 'explaining',
      durationSeconds: 59,
      sentences: [false, false]
    })
    await seedVideo(factoryContext, otherUser.user.id, { title: 'Someone Else Talk', status: 'ready' })

    writeAuthToken(learner.token)
    renderWithProviders(<ShadowingLibraryPage />)

    expect(await screen.findByRole('heading', { name: '跟读练习' })).toBeInTheDocument()

    const readyCard = await findCard('Ready Talk')
    expect(within(readyCard).getByText('02:05')).toBeInTheDocument()
    expect(within(readyCard).getByText('可练习')).toBeInTheDocument()
    expect(within(readyCard).getByText('已解读 2 / 3')).toBeInTheDocument()
    expect(within(readyCard).getByRole('img')).toHaveAttribute(
      'src',
      `https://i.ytimg.com/vi/${ready.youtubeVideoId}/hqdefault.jpg`
    )
    expect(within(readyCard).getByRole('link', { name: '继续练习' })).toHaveAttribute(
      'href',
      `/shadowing/${ready.id}`
    )

    const importingCard = await findCard('导入中…')
    expect(within(importingCard).getByText('导入中')).toBeInTheDocument()
    expect(within(importingCard).queryByRole('link', { name: '继续练习' })).toBeNull()

    const explainingCard = await findCard('Explaining Talk')
    expect(within(explainingCard).getByText('生成解读中')).toBeInTheDocument()
    expect(within(explainingCard).getByText('00:59')).toBeInTheDocument()
    expect(within(explainingCard).getByText('已解读 0 / 2')).toBeInTheDocument()

    expect(screen.getAllByTestId('shadowing-video-card')).toHaveLength(3)
    expect(screen.queryByText('Someone Else Talk')).toBeNull()
  })

  it('shows not supported videos and retries a failed import [AC-SHADOW-003]', async () => {
    const factoryContext = createWebFactoryContext()
    const learner = await createUser(factoryContext, { name: 'Shadowing Failures' })

    await seedVideo(factoryContext, learner.user.id, {
      title: 'No Captions Talk',
      status: 'failed',
      failureReason: 'no_captions',
      failureMessage: 'Video has no English captions'
    })
    await seedVideo(factoryContext, learner.user.id, {
      title: 'Not Embeddable Talk',
      status: 'failed',
      failureReason: 'not_embeddable',
      failureMessage: 'Embedding disabled'
    })
    const broken = await seedVideo(factoryContext, learner.user.id, {
      title: 'Broken Import Talk',
      status: 'failed',
      failureReason: 'import_error',
      failureMessage: 'yt-dlp exited 1: HTTP 429'
    })

    writeAuthToken(learner.token)
    renderWithProviders(<ShadowingLibraryPage />)

    const noCaptionsCard = await findCard('No Captions Talk')
    expect(within(noCaptionsCard).getByText('不支持')).toBeInTheDocument()
    expect(within(noCaptionsCard).getByText('不支持：该视频没有英文字幕')).toBeInTheDocument()
    expect(within(noCaptionsCard).queryByRole('button', { name: '重试' })).toBeNull()

    const notEmbeddableCard = await findCard('Not Embeddable Talk')
    expect(within(notEmbeddableCard).getByText('不支持：该视频不允许嵌入播放')).toBeInTheDocument()

    const brokenCard = await findCard('Broken Import Talk')
    expect(within(brokenCard).getAllByText('导入失败').length).toBeGreaterThan(0)
    expect(within(brokenCard).getByText('yt-dlp exited 1: HTTP 429')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(within(brokenCard).getByRole('button', { name: '重试' }))

    await waitFor(async () => {
      expect(await readVideoStatus(factoryContext, broken.id)).toBe('importing')
    })
    await waitFor(() => {
      expect(within(brokenCard).getByText('导入中')).toBeInTheDocument()
    })
  })

  it('shows a validation error for a URL that is not a YouTube video', async () => {
    const factoryContext = createWebFactoryContext()
    const learner = await createUser(factoryContext, { name: 'Shadowing Invalid Url' })

    writeAuthToken(learner.token)
    renderWithProviders(<ShadowingLibraryPage />)

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('YouTube 视频链接'), 'https://example.com/watch?v=nope')
    await user.click(screen.getByRole('button', { name: '导入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法识别的 YouTube 视频链接')
    expect(await countUserVideos(factoryContext, learner.user.id)).toBe(0)
  })

  it('imports a YouTube URL and shows it as importing', async () => {
    const factoryContext = createWebFactoryContext()
    const learner = await createUser(factoryContext, { name: 'Shadowing Importer' })
    const youtubeVideoId = newYoutubeId()

    writeAuthToken(learner.token)
    renderWithProviders(<ShadowingLibraryPage />)

    expect(await screen.findByText('还没有导入视频。')).toBeInTheDocument()

    const user = userEvent.setup()
    const input = await screen.findByLabelText('YouTube 视频链接')
    await user.type(input, `https://www.youtube.com/watch?v=${youtubeVideoId}`)
    await user.click(screen.getByRole('button', { name: '导入' }))

    const card = await findCard('导入中…')
    expect(within(card).getByText('导入中')).toBeInTheDocument()
    expect(card).toHaveAttribute('data-highlighted', 'true')
    expect(input).toHaveValue('')
    expect(await countUserVideos(factoryContext, learner.user.id)).toBe(1)
    expect(readIntegrationRouterLocation().pathname).not.toBe('/sign-in')
  })

  it('deletes a video after confirmation [REQ-SHADOW-033]', async () => {
    const factoryContext = createWebFactoryContext()
    const learner = await createUser(factoryContext, { name: 'Shadowing Deleter' })
    await seedVideo(factoryContext, learner.user.id, { title: 'Delete Me Talk', status: 'ready' })

    writeAuthToken(learner.token)
    renderWithProviders(<ShadowingLibraryPage />)

    const user = userEvent.setup()
    const card = await findCard('Delete Me Talk')
    await user.click(within(card).getByRole('button', { name: '删除' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('删除视频？')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(screen.queryByText('Delete Me Talk')).toBeNull()
    })
    expect(await countUserVideos(factoryContext, learner.user.id)).toBe(0)
  })
})
