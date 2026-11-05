/**
 * Shadowing import activities against Postgres, with yt-dlp replaced by
 * `__fixtures__/fake-yt-dlp` (via YT_DLP_PATH) and the LLM replaced by a
 * local OpenAI-compatible `/chat/completions` stub (via SHADOWING_LLM_BASE_URL).
 *
 * @spec youtube-shadowing-design §"Testing Strategy"
 */
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApplicationFailure } from '@temporalio/common'
import { getPool } from '@tx-agent-kit/db'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWorkerEnvCache } from './config/env.js'
import { shadowingActivities } from './shadowing-activities.js'

const TEST_PREFIX = 'shadowing-activities-test'
const MODEL = 'shadowing-test-model'
const API_KEY = 'shadowing-test-key'
const fakeYtDlpPath = resolvePath(dirname(fileURLToPath(import.meta.url)), '__fixtures__/fake-yt-dlp')

const MANUAL_ID = 'manualCap01'
const AUTO_ID = 'autoOnly001'
const NO_CAPTIONS_ID = 'noCaptions1'
const NOT_EMBEDDABLE_ID = 'notEmbed001'

// ── LLM stub ──────────────────────────────────────────────────────────

interface ChatMessage {
  readonly role: string
  readonly content: string
}

interface RecordedLlmRequest {
  readonly path: string
  readonly authorization: string | undefined
  readonly model: unknown
  readonly messages: ReadonlyArray<ChatMessage>
}

type LlmReply = { readonly status: number; readonly content: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toMessages = (value: unknown): ReadonlyArray<ChatMessage> =>
  Array.isArray(value)
    ? value.filter(isRecord).map((m) => ({ role: String(m.role), content: String(m.content) }))
    : []

const isSegmentationRequest = (request: RecordedLlmRequest): boolean =>
  request.messages[0]?.content.startsWith('You split') ?? false

/** Target sentence indexes from the explanation task message ("... sentences 0..2: [0, 1, 2]. ..."). */
const requestedIndexes = (request: RecordedLlmRequest): ReadonlyArray<number> => {
  const match = /: \[([\d, ]*)\]/.exec(request.messages.at(-1)?.content ?? '')
  return (match?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0).map(Number)
}

let explanationVersion = 'v1'

const defaultReply = (request: RecordedLlmRequest): LlmReply => {
  if (isSegmentationRequest(request)) {
    return { status: 200, content: JSON.stringify({ sentences: ['Hello world.', 'This is a test.', 'How are you?'] }) }
  }
  return {
    status: 200,
    content: JSON.stringify({
      explanations: requestedIndexes(request).map((sentenceIndex) => ({
        sentenceIndex,
        meaning: `意思 ${sentenceIndex} ${explanationVersion}`,
        keyExpressions: [],
        toneAndContext: '日常口语'
      }))
    })
  }
}

let llmServer: Server | undefined
let llmBaseUrl = ''
const llmRequests: RecordedLlmRequest[] = []
let replyTo: (request: RecordedLlmRequest) => LlmReply = defaultReply

const replyToLlmRequest = (req: IncomingMessage, text: string, res: ServerResponse): void => {
  const parsed: unknown = JSON.parse(text)
  const body = isRecord(parsed) ? parsed : {}
  const request: RecordedLlmRequest = {
    path: req.url ?? '',
    authorization: req.headers.authorization,
    model: body.model,
    messages: toMessages(body.messages)
  }
  llmRequests.push(request)
  const reply = replyTo(request)
  res.writeHead(reply.status, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: reply.content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    })
  )
}

const handleLlmRequest = (req: IncomingMessage, res: ServerResponse): void => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => replyToLlmRequest(req, Buffer.concat(chunks).toString('utf8'), res))
}

const startLlmStub = async (): Promise<void> => {
  const server = createServer(handleLlmRequest)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('LLM stub is not listening on a TCP port')
  }
  llmServer = server
  llmBaseUrl = `http://127.0.0.1:${address.port}/v1`
}

// ── DB helpers ────────────────────────────────────────────────────────

const cleanupUserIds: string[] = []

const seedVideo = async (youtubeVideoId: string, status = 'importing'): Promise<string> => {
  const userId = randomUUID()
  cleanupUserIds.push(userId)
  const pool = getPool()
  await pool.query('INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)', [
    userId,
    `${TEST_PREFIX}-${userId}@example.invalid`,
    'test-hash',
    `${TEST_PREFIX} ${userId}`
  ])
  const result = await pool.query<{ id: string }>(
    'INSERT INTO shadowing_videos (user_id, youtube_video_id, status) VALUES ($1, $2, $3) RETURNING id',
    [userId, youtubeVideoId, status]
  )
  const id = result.rows[0]?.id
  if (id === undefined) {
    throw new Error('Failed to seed shadowing video')
  }
  return id
}

/** Seeds `count` pending sentences (batch = index / 20) on a video in status explaining. */
const seedPendingSentences = async (videoId: string, count: number): Promise<void> => {
  const pool = getPool()
  await pool.query(
    `INSERT INTO shadowing_sentences (video_id, sentence_index, batch_index, text, start_ms, end_ms)
     SELECT $1, i, i / 20, 'Sentence number ' || i || '.', i * 1000, i * 1000 + 900
     FROM generate_series(0, $2::int - 1) AS i`,
    [videoId, count]
  )
  await pool.query(`UPDATE shadowing_videos SET status = 'explaining', sentence_count = $2 WHERE id = $1`, [videoId, count])
}

interface VideoRow {
  status: string
  failure_reason: string | null
  failure_message: string | null
  title: string
  caption_kind: string | null
  sentence_count: number
}

interface SentenceRow {
  id: string
  sentence_index: number
  batch_index: number
  text: string
  start_ms: number
  end_ms: number
  explanation_status: string
  explanation: { meaning: string } | null
}

const getVideo = async (videoId: string): Promise<VideoRow> => {
  const result = await getPool().query<VideoRow>(
    'SELECT status, failure_reason, failure_message, title, caption_kind, sentence_count FROM shadowing_videos WHERE id = $1',
    [videoId]
  )
  const row = result.rows[0]
  if (row === undefined) {
    throw new Error(`Video ${videoId} not found`)
  }
  return row
}

const getSentences = async (videoId: string): Promise<SentenceRow[]> =>
  (
    await getPool().query<SentenceRow>(
      `SELECT id, sentence_index, batch_index, text, start_ms, end_ms, explanation_status, explanation
       FROM shadowing_sentences WHERE video_id = $1 ORDER BY sentence_index`,
      [videoId]
    )
  ).rows

const countSegments = async (videoId: string): Promise<number> => {
  const result = await getPool().query<{ count: string }>(
    'SELECT count(*)::text AS count FROM shadowing_segments WHERE video_id = $1',
    [videoId]
  )
  return Number(result.rows[0]?.count ?? '0')
}

/** Runs the activity and returns the ApplicationFailure it throws. */
const expectApplicationFailure = async (run: () => Promise<unknown>): Promise<ApplicationFailure> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof ApplicationFailure) {
      return error
    }
    throw error
  }
  throw new Error('expected the activity to throw an ApplicationFailure')
}

// ── Lifecycle ─────────────────────────────────────────────────────────

let logDir = ''
let ytDlpLog = ''

beforeAll(async () => {
  await chmod(fakeYtDlpPath, 0o755)
  await startLlmStub()
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (llmServer) {
      llmServer.close(() => resolve())
    } else {
      resolve()
    }
  })
})

beforeEach(async () => {
  logDir = await mkdtemp(join(tmpdir(), 'fake-yt-dlp-log-'))
  ytDlpLog = join(logDir, 'argv.log')
  vi.stubEnv('YT_DLP_PATH', fakeYtDlpPath)
  vi.stubEnv('FAKE_YT_DLP_LOG', ytDlpLog)
  vi.stubEnv('SHADOWING_LLM_API_KEY', API_KEY)
  vi.stubEnv('SHADOWING_LLM_BASE_URL', llmBaseUrl)
  vi.stubEnv('SHADOWING_LLM_MODEL', MODEL)
  resetWorkerEnvCache()
  llmRequests.length = 0
  replyTo = defaultReply
  explanationVersion = 'v1'
})

afterEach(async () => {
  vi.unstubAllEnvs()
  resetWorkerEnvCache()
  await rm(logDir, { recursive: true, force: true })
  if (cleanupUserIds.length > 0) {
    await getPool().query('DELETE FROM users WHERE id = ANY($1::uuid[])', [cleanupUserIds])
    cleanupUserIds.length = 0
  }
})

// ── Tests ─────────────────────────────────────────────────────────────

describe('shadowing activities', () => {
  it('stores aligned sentences with caption timings [INV-SHADOW-004]', async () => {
    const videoId = await seedVideo(MANUAL_ID)

    const result = await shadowingActivities.prepareShadowingTranscript(videoId)

    expect(result).toEqual({ outcome: 'ok', sentenceCount: 3 })
    const sentences = await getSentences(videoId)
    expect(sentences.map((s) => [s.sentence_index, s.batch_index, s.text, s.start_ms, s.end_ms, s.explanation_status])).toEqual([
      [0, 0, 'Hello world.', 1000, 2000, 'pending'],
      [1, 0, 'This is a test.', 2000, 4000, 'pending'],
      [2, 0, 'How are you?', 4000, 6000, 'pending']
    ])
    expect(await countSegments(videoId)).toBeGreaterThanOrEqual(3)
    expect(await getVideo(videoId)).toMatchObject({
      status: 'explaining',
      title: `Fixture video ${MANUAL_ID}`,
      caption_kind: 'manual',
      sentence_count: 3
    })
  })

  it('stores automatic captions when no manual track exists [INV-SHADOW-004]', async () => {
    const videoId = await seedVideo(AUTO_ID)

    await expect(shadowingActivities.prepareShadowingTranscript(videoId)).resolves.toEqual({ outcome: 'ok', sentenceCount: 3 })

    const sentences = await getSentences(videoId)
    expect(sentences.map((s) => s.text)).toEqual(['Hello world.', 'This is a test.', 'How are you?'])
    expect(sentences[0]?.start_ms).toBe(1000)
    expect(sentences[2]?.end_ms).toBe(6000)
    expect((await getVideo(videoId)).caption_kind).toBe('auto')
    const argv = (await readFile(ytDlpLog, 'utf8')).trim().split('\n').map((line): unknown => JSON.parse(line))
    expect(argv[1]).toContain('--write-auto-subs')
  })

  it('segmentation and explanation use the configured model [INV-SHADOW-019]', async () => {
    const videoId = await seedVideo(MANUAL_ID)

    await shadowingActivities.prepareShadowingTranscript(videoId)
    const stored = await shadowingActivities.explainShadowingBatch(videoId, 0)

    expect(stored).toBe(3)
    expect(llmRequests.map((r) => (isSegmentationRequest(r) ? 'segmentation' : 'explanation'))).toEqual([
      'segmentation',
      'explanation'
    ])
    for (const request of llmRequests) {
      expect(request.path).toBe('/v1/chat/completions')
      expect(request.model).toBe(MODEL)
      expect(request.authorization).toBe(`Bearer ${API_KEY}`)
    }
    const sentences = await getSentences(videoId)
    expect(sentences.map((s) => s.explanation_status)).toEqual(['ready', 'ready', 'ready'])
    expect(sentences[1]?.explanation?.meaning).toBe('意思 1 v1')
  })

  it('prioritised batch is selected next [INV-SHADOW-007]', async () => {
    const videoId = await seedVideo(MANUAL_ID)
    await seedPendingSentences(videoId, 70) // batches 0..3

    await expect(shadowingActivities.nextShadowingExplanationBatch(videoId)).resolves.toEqual({ batchIndex: 0 })

    await getPool().query(
      `UPDATE shadowing_sentences SET explanation_requested_at = now() - interval '1 minute'
       WHERE video_id = $1 AND batch_index = 2`,
      [videoId]
    )
    await getPool().query(
      `UPDATE shadowing_sentences SET explanation_requested_at = now() WHERE video_id = $1 AND batch_index = 3`,
      [videoId]
    )
    await expect(shadowingActivities.nextShadowingExplanationBatch(videoId)).resolves.toEqual({ batchIndex: 3 })

    await shadowingActivities.markShadowingBatchFailed(videoId, 3)
    await expect(shadowingActivities.nextShadowingExplanationBatch(videoId)).resolves.toEqual({ batchIndex: 2 })

    for (const batchIndex of [2, 0, 1]) {
      await shadowingActivities.markShadowingBatchFailed(videoId, batchIndex)
    }
    await expect(shadowingActivities.nextShadowingExplanationBatch(videoId)).resolves.toBeNull()
  })

  it('video is ready once batch 0 settles [INV-SHADOW-011]', async () => {
    const videoId = await seedVideo(MANUAL_ID)
    await seedPendingSentences(videoId, 25) // batch 0: 0..19, batch 1: 20..24

    await expect(shadowingActivities.explainShadowingBatch(videoId, 0)).resolves.toBe(20)
    await shadowingActivities.markShadowingVideoReady(videoId)

    expect((await getVideo(videoId)).status).toBe('ready')
    const sentences = await getSentences(videoId)
    expect(sentences.filter((s) => s.batch_index === 0).every((s) => s.explanation_status === 'ready')).toBe(true)
    expect(sentences.filter((s) => s.batch_index === 1).every((s) => s.explanation_status === 'pending')).toBe(true)

    // markReady never resurrects a failed import.
    const failedVideoId = await seedVideo(AUTO_ID)
    await shadowingActivities.failShadowingImport(failedVideoId, 'import_error', 'boom')
    await shadowingActivities.markShadowingVideoReady(failedVideoId)
    expect((await getVideo(failedVideoId)).status).toBe('failed')
  })

  it('malformed LLM output stores nothing [INV-SHADOW-009]', async () => {
    const videoId = await seedVideo(MANUAL_ID)
    await seedPendingSentences(videoId, 3)
    replyTo = (request) =>
      isSegmentationRequest(request)
        ? defaultReply(request)
        : {
            status: 200,
            content: JSON.stringify({
              explanations: [{ sentenceIndex: 0, meaning: '只有一个', keyExpressions: [], toneAndContext: '语气', extra: 'x' }]
            })
          }

    const failure = await expectApplicationFailure(() => shadowingActivities.explainShadowingBatch(videoId, 0))

    expect(failure.nonRetryable).toBe(false)
    expect(failure.type).toBe('import_error')
    expect(failure.message).toContain('Malformed explanation output')
    const sentences = await getSentences(videoId)
    expect(sentences.map((s) => [s.explanation_status, s.explanation])).toEqual([
      ['pending', null],
      ['pending', null],
      ['pending', null]
    ])
  })

  it('fails with no_captions [INV-SHADOW-021]', async () => {
    const videoId = await seedVideo(NO_CAPTIONS_ID)

    const failure = await expectApplicationFailure(() => shadowingActivities.prepareShadowingTranscript(videoId))

    expect(failure.nonRetryable).toBe(true)
    expect(failure.type).toBe('no_captions')
    await shadowingActivities.failShadowingImport(videoId, 'no_captions', failure.message)
    expect(await getVideo(videoId)).toMatchObject({ status: 'failed', failure_reason: 'no_captions' })
    expect(await getSentences(videoId)).toEqual([])
    expect(llmRequests).toEqual([])
  })

  it('fails with not_embeddable [INV-SHADOW-021]', async () => {
    const videoId = await seedVideo(NOT_EMBEDDABLE_ID)

    const failure = await expectApplicationFailure(() => shadowingActivities.prepareShadowingTranscript(videoId))

    expect(failure.nonRetryable).toBe(true)
    expect(failure.type).toBe('not_embeddable')
    await shadowingActivities.failShadowingImport(videoId, 'not_embeddable', failure.message)
    expect(await getVideo(videoId)).toMatchObject({ status: 'failed', failure_reason: 'not_embeddable' })
  })

  it('reports a yt-dlp failure as a retryable import_error [INV-SHADOW-021]', async () => {
    const videoId = await seedVideo('failing0001')

    const failure = await expectApplicationFailure(() => shadowingActivities.prepareShadowingTranscript(videoId))

    expect(failure.nonRetryable).toBe(false)
    expect(failure.type).toBe('import_error')
    expect(failure.message).toContain('Unable to extract video data (simulated)')
  })

  it('runs yt-dlp from YT_DLP_PATH with an argument array [INV-SHADOW-020]', async () => {
    const videoId = await seedVideo(MANUAL_ID)

    await shadowingActivities.prepareShadowingTranscript(videoId)

    const url = `https://www.youtube.com/watch?v=${MANUAL_ID}`
    const calls = (await readFile(ytDlpLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line): string[] => {
        const parsed: unknown = JSON.parse(line)
        return Array.isArray(parsed) ? parsed.map(String) : []
      })
    expect(calls).toHaveLength(2)
    const [metadataCall, captionCall] = calls
    expect(metadataCall).toEqual(['--dump-single-json', '--skip-download', '--no-warnings', '--', url])
    expect(captionCall?.slice(-2)).toEqual(['--', url])
    expect(captionCall).toEqual(expect.arrayContaining(['--write-subs', '--sub-langs', 'en', '--sub-format', 'json3']))
    // The caption temp dir is removed before the activity returns.
    const outputTemplate = captionCall?.[(captionCall.indexOf('-o')) + 1] ?? ''
    await expect(stat(dirname(outputTemplate))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('names missing LLM variables [INV-SHADOW-019]', async () => {
    vi.stubEnv('SHADOWING_LLM_API_KEY', '')
    vi.stubEnv('SHADOWING_LLM_MODEL', '')
    const videoId = await seedVideo(MANUAL_ID)

    const failure = await expectApplicationFailure(() => shadowingActivities.prepareShadowingTranscript(videoId))

    expect(failure.nonRetryable).toBe(true)
    expect(failure.type).toBe('import_error')
    expect(failure.message).toContain('SHADOWING_LLM_API_KEY')
    expect(failure.message).toContain('SHADOWING_LLM_MODEL')
    expect(failure.message).not.toContain('SHADOWING_LLM_BASE_URL')
    expect(llmRequests).toEqual([])
    await shadowingActivities.failShadowingImport(videoId, 'import_error', failure.message)
    const video = await getVideo(videoId)
    expect(video).toMatchObject({ status: 'failed', failure_reason: 'import_error' })
    expect(video.failure_message).toContain('SHADOWING_LLM_API_KEY, SHADOWING_LLM_MODEL')
  })

  it('regenerate replaces explanation [INV-SHADOW-012]', async () => {
    const videoId = await seedVideo(MANUAL_ID)
    await shadowingActivities.prepareShadowingTranscript(videoId)
    await shadowingActivities.explainShadowingBatch(videoId, 0)
    const target = (await getSentences(videoId))[1]
    if (target === undefined) {
      throw new Error('missing sentence 1')
    }
    await getPool().query(`UPDATE shadowing_sentences SET explanation_status = 'regenerating' WHERE id = $1`, [target.id])
    explanationVersion = 'v2'

    await shadowingActivities.regenerateShadowingExplanation(target.id)

    const after = await getSentences(videoId)
    expect(after[1]).toMatchObject({ explanation_status: 'ready', explanation: { meaning: '意思 1 v2' } })
    expect(after[0]?.explanation?.meaning).toBe('意思 0 v1')
    expect(requestedIndexes(llmRequests.at(-1) ?? { path: '', authorization: undefined, model: null, messages: [] })).toEqual([1])

    // A failed regeneration keeps the previous explanation.
    await getPool().query(`UPDATE shadowing_sentences SET explanation_status = 'regenerating' WHERE id = $1`, [target.id])
    await shadowingActivities.failShadowingRegeneration(target.id, 'LLM unavailable')
    expect((await getSentences(videoId))[1]).toMatchObject({ explanation_status: 'failed', explanation: { meaning: '意思 1 v2' } })
  })

  it('re-running prepare does not duplicate sentences [INV-SHADOW-023]', async () => {
    const videoId = await seedVideo(MANUAL_ID)

    await shadowingActivities.prepareShadowingTranscript(videoId)
    const segmentsAfterFirstRun = await countSegments(videoId)
    await shadowingActivities.prepareShadowingTranscript(videoId)

    const sentences = await getSentences(videoId)
    expect(sentences.map((s) => s.sentence_index)).toEqual([0, 1, 2])
    expect(await countSegments(videoId)).toBe(segmentsAfterFirstRun)
    expect((await getVideo(videoId)).sentence_count).toBe(3)
  })

  it('returns gone for a deleted video', async () => {
    await expect(shadowingActivities.prepareShadowingTranscript(randomUUID())).resolves.toEqual({ outcome: 'gone' })
    await expect(shadowingActivities.nextShadowingExplanationBatch(randomUUID())).resolves.toBeNull()
  })
})
