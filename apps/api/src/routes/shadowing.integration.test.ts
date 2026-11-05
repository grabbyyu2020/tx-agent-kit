import { randomUUID } from 'node:crypto'
import { createUser } from '@tx-agent-kit/testkit'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './test-helpers.js'

/**
 * Shadowing API integration tests.
 *
 * @spec youtube-shadowing-design §"Interfaces" §"API Endpoints" §"Verification"
 */

const { request, getFactoryContext, dbAuthContext } = createTestFixture({
  schemaPrefix: 'api_shadowing'
})

interface VideoSummaryBody {
  id: string
  youtubeVideoId: string
  title: string
  status: string
  failureReason: string | null
  failureMessage: string | null
  sentenceCount: number
  explainedCount: number
  lastSegmentIndex: number
  createdAt: string
  updatedAt: string
}

interface SentenceBody {
  id: string
  sentenceIndex: number
  batchIndex: number
  text: string
  explanationStatus: string
  explanation: unknown
}

interface ErrorBody {
  message?: string
}

const youtubeUrl = (youtubeVideoId: string): string => `https://www.youtube.com/watch?v=${youtubeVideoId}`

// 11-character ids drawn from [A-Za-z0-9_-]
const newYoutubeId = (): string => randomUUID().replaceAll('-', '').slice(0, 11)

const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` })

/** Raw request for status-only assertions (no body parsing). */
const send = async (path: string, caseName: string, init: RequestInit): Promise<Response> => {
  const existingHeaders: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => {
    existingHeaders[key] = value
  })
  return fetch(`${dbAuthContext.baseUrl}${path}`, {
    ...init,
    headers: dbAuthContext.testContext.headersForCase(caseName, {
      'content-type': 'application/json',
      ...existingHeaders
    })
  })
}

const importVideo = (token: string, url: string, caseName: string) =>
  request<{ video: VideoSummaryBody; created: boolean } & ErrorBody>('/v1/shadowing/videos', caseName, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ url })
  })

const query = async <Row extends object>(sql: string, params: ReadonlyArray<unknown>): Promise<Row[]> => {
  let rows: Row[] = []
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<Row>(sql, [...params])
    rows = result.rows
  })
  return rows
}

const readEvents = (aggregateId: string, eventType: string) =>
  query<{ event_type: string; aggregate_type: string; aggregate_id: string; payload: Record<string, unknown> }>(
    `SELECT event_type, aggregate_type, aggregate_id, payload
       FROM domain_events
      WHERE aggregate_id = $1 AND event_type = $2
      ORDER BY created_at`,
    [aggregateId, eventType]
  )

const countVideos = async (userId: string): Promise<number> => {
  const rows = await query<{ count: string }>('SELECT count(*)::text AS count FROM shadowing_videos WHERE user_id = $1', [userId])
  return Number(rows[0]?.count ?? 0)
}

const countShadowingEvents = async (): Promise<number> => {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM domain_events WHERE aggregate_type = 'shadowing'`,
    []
  )
  return Number(rows[0]?.count ?? 0)
}

const sampleExplanation = {
  meaning: '这句话的意思是',
  keyExpressions: [{ expression: 'make it', explanation: '成功' }],
  toneAndContext: '口语，轻松'
}

/**
 * Seed one sentence (and one segment for it) per entry; `ready` sentences get
 * `sampleExplanation`. Sentence `i` goes into
 * batch `batchIndex ?? floor(i / 20)`; each sentence gets exactly one segment
 * with segment_index = sentence_index.
 */
const seedTranscript = async (
  videoId: string,
  sentences: ReadonlyArray<{
    status: 'pending' | 'ready' | 'failed' | 'regenerating'
    batchIndex?: number
  }>
): Promise<void> => {
  await dbAuthContext.testContext.withSchemaClient(async (client) => {
    for (const [index, sentence] of sentences.entries()) {
      const explanation = sentence.status === 'ready' ? sampleExplanation : null
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO shadowing_sentences (video_id, sentence_index, batch_index, text, start_ms, end_ms, explanation, explanation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id`,
        [
          videoId,
          index,
          sentence.batchIndex ?? Math.floor(index / 20),
          `Sentence ${index}.`,
          index * 1000,
          index * 1000 + 900,
          explanation === null ? null : JSON.stringify(explanation),
          sentence.status
        ]
      )
      await client.query(
        `INSERT INTO shadowing_segments (video_id, sentence_id, segment_index, sentence_index, text, start_ms, end_ms)
         VALUES ($1, $2, $3, $3, $4, $5, $6)`,
        [videoId, inserted.rows[0]?.id, index, `Sentence ${index}.`, index * 1000, index * 1000 + 900]
      )
    }
    await client.query(
      `UPDATE shadowing_videos SET status = 'explaining', sentence_count = $2 WHERE id = $1`,
      [videoId, sentences.length]
    )
  })
}

const createImportedVideo = async (token: string, caseName: string): Promise<VideoSummaryBody> => {
  const result = await importVideo(token, youtubeUrl(newYoutubeId()), caseName)
  expect(result.response.status).toBe(200)
  return result.body.video
}

describe('shadowing import', () => {
  it('creates an importing video and an import event [INV-SHADOW-001]', async () => {
    const user = await createUser(getFactoryContext())
    const youtubeVideoId = newYoutubeId()

    const result = await importVideo(user.token, youtubeUrl(youtubeVideoId), 'shadowing-import-create')

    expect(result.response.status).toBe(200)
    expect(result.body.created).toBe(true)
    expect(result.body.video).toMatchObject({
      youtubeVideoId,
      status: 'importing',
      failureReason: null,
      sentenceCount: 0,
      explainedCount: 0,
      lastSegmentIndex: 0
    })
    expect(Number.isNaN(Date.parse(result.body.video.createdAt))).toBe(false)

    const events = await readEvents(result.body.video.id, 'shadowing.video_import_requested')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ aggregate_type: 'shadowing', aggregate_id: result.body.video.id })
    expect(events[0]?.payload).toEqual({ videoId: result.body.video.id, userId: user.user.id })
  })

  it('returns the existing video for a repeated URL [INV-SHADOW-001]', async () => {
    const user = await createUser(getFactoryContext())
    const youtubeVideoId = newYoutubeId()

    const first = await importVideo(user.token, youtubeUrl(youtubeVideoId), 'shadowing-import-repeat-1')
    const second = await importVideo(user.token, `https://youtu.be/${youtubeVideoId}`, 'shadowing-import-repeat-2')

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(200)
    expect(second.body.created).toBe(false)
    expect(second.body.video.id).toBe(first.body.video.id)
    expect(await countVideos(user.user.id)).toBe(1)
    expect(await readEvents(first.body.video.id, 'shadowing.video_import_requested')).toHaveLength(1)
  })

  it('rejects non-YouTube URLs [INV-SHADOW-002]', async () => {
    const user = await createUser(getFactoryContext())
    const eventsBefore = await countShadowingEvents()

    for (const [index, url] of [
      'https://vimeo.com/123456789',
      'https://www.youtube.com/watch?v=short',
      'not a url'
    ].entries()) {
      const result = await importVideo(user.token, url, `shadowing-import-invalid-${index}`)
      expect(result.response.status).toBe(400)
    }

    expect(await countVideos(user.user.id)).toBe(0)
    expect(await countShadowingEvents()).toBe(eventsBefore)
  })
})

describe('shadowing access control', () => {
  it('rejects unauthenticated requests [INV-SHADOW-018]', async () => {
    const videoId = randomUUID()
    const routes: ReadonlyArray<{ method: string; path: string; body?: unknown }> = [
      { method: 'POST', path: '/v1/shadowing/videos', body: { url: youtubeUrl(newYoutubeId()) } },
      { method: 'GET', path: '/v1/shadowing/videos' },
      { method: 'GET', path: `/v1/shadowing/videos/${videoId}` },
      { method: 'DELETE', path: `/v1/shadowing/videos/${videoId}` },
      { method: 'POST', path: `/v1/shadowing/videos/${videoId}/retry` },
      { method: 'PUT', path: `/v1/shadowing/videos/${videoId}/progress`, body: { segmentIndex: 0 } },
      { method: 'POST', path: `/v1/shadowing/videos/${videoId}/sentences/0/prioritize` },
      { method: 'POST', path: `/v1/shadowing/videos/${videoId}/sentences/0/regenerate` }
    ]

    for (const [index, route] of routes.entries()) {
      const response = await send(route.path, `shadowing-unauth-${index}`, {
        method: route.method,
        ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) })
      })
      expect(response.status, `${route.method} ${route.path}`).toBe(401)
    }
  })

  it("returns 404 for another user's video [INV-SHADOW-018]", async () => {
    const owner = await createUser(getFactoryContext())
    const intruder = await createUser(getFactoryContext())
    const video = await createImportedVideo(owner.token, 'shadowing-404-seed')
    await seedTranscript(video.id, [{ status: 'ready' }])
    await query(`UPDATE shadowing_videos SET status = 'failed', failure_reason = 'import_error' WHERE id = $1`, [video.id])

    const base = `/v1/shadowing/videos/${video.id}`
    const routes: ReadonlyArray<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: base },
      { method: 'DELETE', path: base },
      { method: 'POST', path: `${base}/retry` },
      { method: 'PUT', path: `${base}/progress`, body: { segmentIndex: 0 } },
      { method: 'POST', path: `${base}/sentences/0/prioritize` },
      { method: 'POST', path: `${base}/sentences/0/regenerate` }
    ]

    for (const [index, route] of routes.entries()) {
      const response = await send(route.path, `shadowing-404-${index}`, {
        method: route.method,
        headers: authHeaders(intruder.token),
        ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) })
      })
      expect(response.status, `${route.method} ${route.path}`).toBe(404)
    }

    // A missing id answers exactly like a foreign one.
    const missing = await send(`/v1/shadowing/videos/${randomUUID()}`, 'shadowing-404-missing', {
      method: 'GET',
      headers: authHeaders(owner.token)
    })
    expect(missing.status).toBe(404)

    // Nothing was changed on the owner's video.
    const rows = await query<{ status: string; last_segment_index: number }>(
      'SELECT status, last_segment_index FROM shadowing_videos WHERE id = $1',
      [video.id]
    )
    expect(rows).toEqual([{ status: 'failed', last_segment_index: 0 }])
  })
})

describe('shadowing library and detail', () => {
  it("lists only the caller's videos [INV-SHADOW-016]", async () => {
    const user = await createUser(getFactoryContext())
    const other = await createUser(getFactoryContext())
    const older = await createImportedVideo(user.token, 'shadowing-list-older')
    const newer = await createImportedVideo(user.token, 'shadowing-list-newer')
    await createImportedVideo(other.token, 'shadowing-list-other')
    await query(`UPDATE shadowing_videos SET created_at = now() - interval '1 hour' WHERE id = $1`, [older.id])
    await seedTranscript(newer.id, [{ status: 'ready' }, { status: 'ready' }, { status: 'pending' }])

    const result = await request<{ data: VideoSummaryBody[] }>('/v1/shadowing/videos', 'shadowing-list', {
      method: 'GET',
      headers: authHeaders(user.token)
    })

    expect(result.response.status).toBe(200)
    expect(result.body.data.map((video) => video.id)).toEqual([newer.id, older.id])
    expect(result.body.data[0]).toMatchObject({ sentenceCount: 3, explainedCount: 2, status: 'explaining' })
    expect(result.body.data[1]).toMatchObject({ sentenceCount: 0, explainedCount: 0 })
  })

  it('detail serves stored explanations without LLM calls [INV-SHADOW-013]', async () => {
    const user = await createUser(getFactoryContext())
    const video = await createImportedVideo(user.token, 'shadowing-detail-seed')
    await seedTranscript(video.id, [{ status: 'ready' }, { status: 'pending' }])

    const result = await request<{
      video: VideoSummaryBody
      sentences: SentenceBody[]
      segments: Array<{ segmentIndex: number; sentenceIndex: number; text: string; startMs: number; endMs: number }>
    }>(`/v1/shadowing/videos/${video.id}`, 'shadowing-detail', {
      method: 'GET',
      headers: authHeaders(user.token)
    })

    expect(result.response.status).toBe(200)
    expect(result.body.video).toMatchObject({ id: video.id, sentenceCount: 2, explainedCount: 1 })
    expect(result.body.sentences.map((s) => [s.sentenceIndex, s.explanationStatus])).toEqual([
      [0, 'ready'],
      [1, 'pending']
    ])
    expect(result.body.sentences[0]?.explanation).toEqual(sampleExplanation)
    expect(result.body.sentences[1]?.explanation).toBeNull()
    expect(result.body.segments).toEqual([
      { segmentIndex: 0, sentenceIndex: 0, text: 'Sentence 0.', startMs: 0, endMs: 900 },
      { segmentIndex: 1, sentenceIndex: 1, text: 'Sentence 1.', startMs: 1000, endMs: 1900 }
    ])
  })
})

describe('shadowing practice actions', () => {
  it('saves progress [INV-SHADOW-016]', async () => {
    const user = await createUser(getFactoryContext())
    const video = await createImportedVideo(user.token, 'shadowing-progress-seed')
    await seedTranscript(video.id, [{ status: 'pending' }, { status: 'pending' }, { status: 'pending' }])
    const path = `/v1/shadowing/videos/${video.id}/progress`

    const saved = await send(path, 'shadowing-progress-save', {
      method: 'PUT',
      headers: authHeaders(user.token),
      body: JSON.stringify({ segmentIndex: 2 })
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ lastSegmentIndex: 2 })

    const outOfRange = await send(path, 'shadowing-progress-out-of-range', {
      method: 'PUT',
      headers: authHeaders(user.token),
      body: JSON.stringify({ segmentIndex: 3 })
    })
    expect(outOfRange.status).toBe(400)

    const negative = await send(path, 'shadowing-progress-negative', {
      method: 'PUT',
      headers: authHeaders(user.token),
      body: JSON.stringify({ segmentIndex: -1 })
    })
    expect(negative.status).toBe(400)

    const detail = await request<{ video: VideoSummaryBody }>(`/v1/shadowing/videos/${video.id}`, 'shadowing-progress-read', {
      method: 'GET',
      headers: authHeaders(user.token)
    })
    expect(detail.body.video.lastSegmentIndex).toBe(2)
  })

  it('prioritize requests explanations for the pending sentences of that batch only', async () => {
    const user = await createUser(getFactoryContext())
    const video = await createImportedVideo(user.token, 'shadowing-prioritize-seed')
    await seedTranscript(video.id, [
      { status: 'ready', batchIndex: 0 },
      { status: 'pending', batchIndex: 0 },
      { status: 'pending', batchIndex: 1 },
      { status: 'ready', batchIndex: 1 },
      { status: 'pending', batchIndex: 1 },
      { status: 'pending', batchIndex: 2 }
    ])

    const response = await send(`/v1/shadowing/videos/${video.id}/sentences/3/prioritize`, 'shadowing-prioritize', {
      method: 'POST',
      headers: authHeaders(user.token)
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ prioritized: true })

    const rows = await query<{ sentence_index: number; requested: boolean }>(
      `SELECT sentence_index, explanation_requested_at IS NOT NULL AS requested
         FROM shadowing_sentences WHERE video_id = $1 ORDER BY sentence_index`,
      [video.id]
    )
    expect(rows.filter((row) => row.requested).map((row) => row.sentence_index)).toEqual([2, 4])

    const missing = await send(`/v1/shadowing/videos/${video.id}/sentences/99/prioritize`, 'shadowing-prioritize-missing', {
      method: 'POST',
      headers: authHeaders(user.token)
    })
    expect(missing.status).toBe(404)
  })

  it('regenerate moves a sentence to regenerating with an event [INV-SHADOW-012]', async () => {
    const user = await createUser(getFactoryContext())
    const video = await createImportedVideo(user.token, 'shadowing-regenerate-seed')
    await seedTranscript(video.id, [{ status: 'ready' }, { status: 'pending' }])

    const result = await request<SentenceBody>(
      `/v1/shadowing/videos/${video.id}/sentences/0/regenerate`,
      'shadowing-regenerate',
      { method: 'POST', headers: authHeaders(user.token) }
    )
    expect(result.response.status).toBe(202)
    expect(result.body).toMatchObject({ sentenceIndex: 0, explanationStatus: 'regenerating' })

    const events = await readEvents(video.id, 'shadowing.explanation_regenerate_requested')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({ videoId: video.id, sentenceId: result.body.id })

    const again = await request<ErrorBody>(
      `/v1/shadowing/videos/${video.id}/sentences/0/regenerate`,
      'shadowing-regenerate-while-regenerating',
      { method: 'POST', headers: authHeaders(user.token) }
    )
    expect(again.response.status).toBe(409)

    const pending = await request<ErrorBody>(
      `/v1/shadowing/videos/${video.id}/sentences/1/regenerate`,
      'shadowing-regenerate-pending',
      { method: 'POST', headers: authHeaders(user.token) }
    )
    expect(pending.response.status).toBe(409)
    expect(await readEvents(video.id, 'shadowing.explanation_regenerate_requested')).toHaveLength(1)
  })

  it('retry resets a failed import and writes an event [INV-SHADOW-021]', async () => {
    const user = await createUser(getFactoryContext())
    const video = await createImportedVideo(user.token, 'shadowing-retry-seed')

    const notFailed = await request<ErrorBody>(`/v1/shadowing/videos/${video.id}/retry`, 'shadowing-retry-not-failed', {
      method: 'POST',
      headers: authHeaders(user.token)
    })
    expect(notFailed.response.status).toBe(409)
    expect(await readEvents(video.id, 'shadowing.video_import_requested')).toHaveLength(1)

    await query(
      `UPDATE shadowing_videos SET status = 'failed', failure_reason = 'no_captions', failure_message = 'No English captions' WHERE id = $1`,
      [video.id]
    )

    const retried = await request<VideoSummaryBody>(`/v1/shadowing/videos/${video.id}/retry`, 'shadowing-retry', {
      method: 'POST',
      headers: authHeaders(user.token)
    })
    expect(retried.response.status).toBe(202)
    expect(retried.body).toMatchObject({ id: video.id, status: 'importing', failureReason: null, failureMessage: null })

    const events = await readEvents(video.id, 'shadowing.video_import_requested')
    expect(events).toHaveLength(2)
    expect(events[1]?.payload).toEqual({ videoId: video.id, userId: user.user.id })
  })

  it('delete cascades sentences and segments [INV-SHADOW-017]', async () => {
    const user = await createUser(getFactoryContext())
    const doomed = await createImportedVideo(user.token, 'shadowing-delete-doomed')
    const kept = await createImportedVideo(user.token, 'shadowing-delete-kept')
    await seedTranscript(doomed.id, [{ status: 'ready' }, { status: 'pending' }])
    await seedTranscript(kept.id, [{ status: 'pending' }])

    const response = await send(`/v1/shadowing/videos/${doomed.id}`, 'shadowing-delete', {
      method: 'DELETE',
      headers: authHeaders(user.token)
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })

    const counts = await query<{ video_id: string; videos: string; sentences: string; segments: string }>(
      `SELECT v.id AS video_id,
              (SELECT count(*)::text FROM shadowing_videos WHERE id = v.id) AS videos,
              (SELECT count(*)::text FROM shadowing_sentences WHERE video_id = v.id) AS sentences,
              (SELECT count(*)::text FROM shadowing_segments WHERE video_id = v.id) AS segments
         FROM (VALUES ($1::uuid), ($2::uuid)) AS v(id)`,
      [doomed.id, kept.id]
    )
    expect(counts).toEqual([
      { video_id: doomed.id, videos: '0', sentences: '0', segments: '0' },
      { video_id: kept.id, videos: '1', sentences: '1', segments: '1' }
    ])

    const again = await send(`/v1/shadowing/videos/${doomed.id}`, 'shadowing-delete-again', {
      method: 'DELETE',
      headers: authHeaders(user.token)
    })
    expect(again.status).toBe(404)
  })
})
