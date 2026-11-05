import { randomUUID } from 'node:crypto'
import type { ShadowingExplanation } from '@tx-agent-kit/contracts'
import { Effect, Either, Option } from 'effect'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetPool } from '../client.js'
import { getDbEnv } from '../env.js'
import {
  applySqlFiles,
  applySqlMigration,
  ensureMigrationTable,
  getMigrationFiles,
  getSchemaFiles,
  resolveRepoRoot
} from '../sql-admin.js'
import {
  shadowingRepository,
  type NewShadowingSegmentInput,
  type NewShadowingSentenceInput
} from './shadowing.js'

// Self-contained per-schema harness: @tx-agent-kit/testkit depends on this
// package, so it cannot be imported here. Mirrors testkit's sql-context: an
// isolated schema, migrations applied under the shared global migration lock,
// unqualified function drops scoped to the schema, and the repository runtime
// repointed at the schema via DATABASE_URL + resetPool().
const globalMigrationLockId = 4_602_001
const schemaName = `shadowing_repo_${randomUUID().replaceAll('-', '').slice(0, 16)}`
const baseDatabaseUrl = getDbEnv().DATABASE_URL
const originalDatabaseUrl = process.env.DATABASE_URL

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`

const buildSchemaDatabaseUrl = (): string => {
  const url = new URL(baseDatabaseUrl)
  url.searchParams.set('options', `-csearch_path=${schemaName},public`)
  return url.toString()
}

const scopeUnqualifiedFunctionDrops = (sql: string): string =>
  sql.replaceAll(
    /(DROP FUNCTION IF EXISTS\s+)([A-Za-z_][A-Za-z0-9_$]*)(\s*\(\s*\)\s*CASCADE\s*;)/giu,
    (_statement: string, prefix: string, functionName: string, suffix: string) =>
      `${prefix}${quoteIdentifier(schemaName)}.${functionName}${suffix}`
  )

let client: Client

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

const query = async <Row extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<Row[]> =>
  (await client.query<Row>(text, values)).rows

const explanation = (meaning: string): ShadowingExplanation => ({
  meaning,
  keyExpressions: [{ expression: 'hello', explanation: '你好' }],
  toneAndContext: '友好'
})

const createUser = async (): Promise<string> => {
  const [row] = await query<{ id: string }>(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
    [`shadowing-${randomUUID()}@example.invalid`, 'not-a-real-hash', 'Shadowing Tester']
  )
  if (!row) {
    throw new Error('user insert returned no row')
  }
  return row.id
}

// Sentences 0..(count-1), batch = floor(index / batchSize), one segment per sentence.
const buildTranscript = (count: number, batchSize: number, label = 'Sentence') => {
  const sentences: NewShadowingSentenceInput[] = Array.from({ length: count }, (_, index) => ({
    sentenceIndex: index,
    batchIndex: Math.floor(index / batchSize),
    text: `${label} ${index}.`,
    startMs: index * 1000,
    endMs: index * 1000 + 900
  }))
  const segments: NewShadowingSegmentInput[] = sentences.map((sentence) => ({
    segmentIndex: sentence.sentenceIndex,
    sentenceIndex: sentence.sentenceIndex,
    text: sentence.text,
    startMs: sentence.startMs,
    endMs: sentence.endMs
  }))
  return { sentences, segments }
}

const createVideoWithTranscript = async (count: number, batchSize: number) => {
  const userId = await createUser()
  const { video } = await run(
    shadowingRepository.insertVideoWithImportEvent({ userId, youtubeVideoId: randomUUID().slice(0, 11) })
  )
  const transcript = buildTranscript(count, batchSize)
  await run(shadowingRepository.replaceTranscript(video.id, transcript.sentences, transcript.segments))
  return { userId, videoId: video.id }
}

const countRows = async (table: 'shadowing_sentences' | 'shadowing_segments', videoId: string): Promise<number> => {
  const [row] = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table} WHERE video_id = $1`,
    [videoId]
  )
  return row?.count ?? 0
}

const eventsFor = (aggregateId: string) =>
  query<{ event_type: string; aggregate_type: string; payload: Record<string, unknown> }>(
    'SELECT event_type, aggregate_type, payload FROM domain_events WHERE aggregate_id = $1 ORDER BY created_at, id',
    [aggregateId]
  )

beforeAll(async () => {
  client = new Client({ connectionString: baseDatabaseUrl })
  await client.connect()
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`)
  await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}, public`)
  await ensureMigrationTable(client)

  const repoRoot = resolveRepoRoot()
  await client.query('SELECT pg_advisory_lock($1)', [globalMigrationLockId])
  try {
    for (const migration of getMigrationFiles(repoRoot)) {
      await applySqlMigration(client, { name: migration.name, sql: scopeUnqualifiedFunctionDrops(migration.sql) })
    }
    await applySqlFiles(client, getSchemaFiles(repoRoot))
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [globalMigrationLockId])
  }

  process.env.DATABASE_URL = buildSchemaDatabaseUrl()
  await resetPool()
})

beforeEach(async () => {
  await client.query('TRUNCATE shadowing_segments, shadowing_sentences, shadowing_videos, domain_events, users CASCADE')
})

afterAll(async () => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl
  }
  await resetPool()
  await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
  await client.end()
})

describe('shadowingRepository', () => {
  it('inserts an importing video with one import outbox event; a re-submit returns the existing row and writes no event [INV-SHADOW-001]', async () => {
    const userId = await createUser()

    const first = await run(shadowingRepository.insertVideoWithImportEvent({ userId, youtubeVideoId: 'dQw4w9WgXcQ' }))
    expect(first.created).toBe(true)
    expect(first.video).toMatchObject({ userId, youtubeVideoId: 'dQw4w9WgXcQ', status: 'importing', explainedCount: 0 })

    const second = await run(shadowingRepository.insertVideoWithImportEvent({ userId, youtubeVideoId: 'dQw4w9WgXcQ' }))
    expect(second.created).toBe(false)
    expect(second.video.id).toBe(first.video.id)

    const events = await eventsFor(first.video.id)
    expect(events).toEqual([
      {
        event_type: 'shadowing.video_import_requested',
        aggregate_type: 'shadowing',
        payload: { videoId: first.video.id, userId }
      }
    ])
  })

  it('concurrent inserts of the same (user, YouTube id) create one row and one event [INV-SHADOW-001]', async () => {
    const userId = await createUser()
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        run(shadowingRepository.insertVideoWithImportEvent({ userId, youtubeVideoId: 'abcdefghijk' }))
      )
    )

    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(new Set(results.map((result) => result.video.id)).size).toBe(1)
    const videoId = results[0]?.video.id ?? ''
    expect(await eventsFor(videoId)).toHaveLength(1)
  })

  it('replaceTranscript run twice leaves exactly the latest sentences and segments [INV-SHADOW-023]', async () => {
    const { videoId } = await createVideoWithTranscript(5, 2)
    const replacement = buildTranscript(3, 2, 'Again')
    await run(shadowingRepository.replaceTranscript(videoId, replacement.sentences, replacement.segments))
    await run(shadowingRepository.replaceTranscript(videoId, replacement.sentences, replacement.segments))

    expect(await countRows('shadowing_sentences', videoId)).toBe(3)
    expect(await countRows('shadowing_segments', videoId)).toBe(3)

    const detail = Option.getOrThrow(await run(shadowingRepository.getVideoDetail(videoId)))
    expect(detail.video).toMatchObject({ status: 'explaining', sentenceCount: 3, explainedCount: 0 })
    expect(detail.sentences.map((sentence) => [sentence.sentenceIndex, sentence.batchIndex, sentence.text, sentence.explanationStatus]))
      .toEqual([[0, 0, 'Again 0.', 'pending'], [1, 0, 'Again 1.', 'pending'], [2, 1, 'Again 2.', 'pending']])
    const sentenceIdByIndex = new Map(detail.sentences.map((sentence) => [sentence.sentenceIndex, sentence.id]))
    for (const segment of detail.segments) {
      expect(segment.sentenceId).toBe(sentenceIdByIndex.get(segment.sentenceIndex))
    }
  })

  it('nextPendingBatchIndex prefers the latest requested batch, else the lowest pending batch [INV-SHADOW-007]', async () => {
    const { videoId } = await createVideoWithTranscript(6, 2)
    const next = () => run(shadowingRepository.nextPendingBatchIndex(videoId))

    expect(await next()).toEqual(Option.some(0))

    expect(await run(shadowingRepository.prioritizeBatchOfSentence(videoId, 5))).toBe(2)
    expect(await next()).toEqual(Option.some(2))

    await run(shadowingRepository.prioritizeBatchOfSentence(videoId, 2))
    expect(await next()).toEqual(Option.some(1))

    await run(shadowingRepository.storeExplanations(videoId, 1, new Map([[2, explanation('二')], [3, explanation('三')]])))
    expect(await next()).toEqual(Option.some(2))

    await run(shadowingRepository.markBatchFailed(videoId, 2))
    expect(await next()).toEqual(Option.some(0))

    await run(shadowingRepository.storeExplanations(videoId, 0, new Map([[0, explanation('零')], [1, explanation('一')]])))
    expect(await next()).toEqual(Option.none())

    const [video] = await run(shadowingRepository.listVideosForUser(
      Option.getOrThrow(await run(shadowingRepository.getVideoDetail(videoId))).video.userId
    ))
    expect(video?.explainedCount).toBe(4)
  })

  it('storeExplanations only writes sentences still pending in that batch; regeneration is accepted only from ready|failed [INV-SHADOW-012]', async () => {
    const { videoId } = await createVideoWithTranscript(4, 2)

    // Not regenerable while pending.
    expect(await run(shadowingRepository.markSentenceRegenerating(videoId, 0))).toEqual(Option.none())

    expect(await run(shadowingRepository.storeExplanations(videoId, 0, new Map([[0, explanation('原')], [1, explanation('一')]])))).toBe(2)

    const regenerating = Option.getOrThrow(await run(shadowingRepository.markSentenceRegenerating(videoId, 0)))
    expect(regenerating.explanationStatus).toBe('regenerating')
    expect(await eventsFor(videoId)).toContainEqual({
      event_type: 'shadowing.explanation_regenerate_requested',
      aggregate_type: 'shadowing',
      payload: { videoId, sentenceId: regenerating.id }
    })
    // Already regenerating: rejected, no second event.
    expect(await run(shadowingRepository.markSentenceRegenerating(videoId, 0))).toEqual(Option.none())

    // The import workflow writing batch 0 again touches nothing (0 regenerating, 1 ready);
    // an index from batch 0 passed with batch 1 is ignored too.
    expect(await run(shadowingRepository.storeExplanations(videoId, 0, new Map([[0, explanation('覆盖')], [1, explanation('覆盖')]])))).toBe(0)
    expect(await run(shadowingRepository.storeExplanations(videoId, 1, new Map([[0, explanation('覆盖')], [2, explanation('二')]])))).toBe(1)

    const sentences = await run(shadowingRepository.listSentences(videoId))
    expect(sentences.map((sentence) => [sentence.explanationStatus, sentence.explanation?.meaning ?? null]))
      .toEqual([['regenerating', '原'], ['ready', '一'], ['ready', '二'], ['pending', null]])

    // Failed regeneration keeps the old explanation; a later success replaces it.
    expect(await run(shadowingRepository.finishRegeneration(regenerating.id, Either.left('llm timeout')))).toBe(true)
    expect(await run(shadowingRepository.finishRegeneration(regenerating.id, Either.right(explanation('新'))))).toBe(false)
    Option.getOrThrow(await run(shadowingRepository.markSentenceRegenerating(videoId, 0)))
    expect(await run(shadowingRepository.finishRegeneration(regenerating.id, Either.right(explanation('新'))))).toBe(true)

    const [first] = await run(shadowingRepository.listSentences(videoId))
    expect(first).toMatchObject({ explanationStatus: 'ready', explanation: explanation('新') })
    expect((await eventsFor(videoId)).filter((event) => event.event_type === 'shadowing.explanation_regenerate_requested')).toHaveLength(2)
  })

  it('deleting a video cascades to its sentences and segments and leaves other videos untouched [INV-SHADOW-017]', async () => {
    const doomed = await createVideoWithTranscript(3, 2)
    const kept = await createVideoWithTranscript(2, 2)

    expect(await run(shadowingRepository.deleteVideo(doomed.videoId))).toBe(true)

    expect(await countRows('shadowing_sentences', doomed.videoId)).toBe(0)
    expect(await countRows('shadowing_segments', doomed.videoId)).toBe(0)
    expect(await countRows('shadowing_sentences', kept.videoId)).toBe(2)
    expect(await countRows('shadowing_segments', kept.videoId)).toBe(2)
    expect(await run(shadowingRepository.findVideoForUser(doomed.userId, doomed.videoId))).toEqual(Option.none())
    expect(Option.isSome(await run(shadowingRepository.findVideoForUser(kept.userId, kept.videoId)))).toBe(true)
  })

  it('retry is only accepted from failed and writes a new import event; progress must point at an existing segment', async () => {
    const { userId, videoId } = await createVideoWithTranscript(3, 2)

    expect(await run(shadowingRepository.resetVideoForRetry(videoId))).toEqual(Option.none())

    await run(shadowingRepository.setVideoStatus(videoId, 'failed', { reason: 'import_error', message: 'yt-dlp exited 1' }))
    const failed = Option.getOrThrow(await run(shadowingRepository.findVideoForUser(userId, videoId)))
    expect(failed).toMatchObject({ status: 'failed', failureReason: 'import_error', failureMessage: 'yt-dlp exited 1' })

    const reset = Option.getOrThrow(await run(shadowingRepository.resetVideoForRetry(videoId)))
    expect(reset).toMatchObject({ status: 'importing', failureReason: null, failureMessage: null })
    expect((await eventsFor(videoId)).filter((event) => event.event_type === 'shadowing.video_import_requested')).toHaveLength(2)

    expect(await run(shadowingRepository.saveProgress(videoId, 3))).toBe(false)
    expect(await run(shadowingRepository.saveProgress(videoId, 2))).toBe(true)
    expect(Option.getOrThrow(await run(shadowingRepository.findVideoForUser(userId, videoId))).lastSegmentIndex).toBe(2)
    // Another user's id does not find the video.
    expect(await run(shadowingRepository.findVideoForUser(await createUser(), videoId))).toEqual(Option.none())
  })
})
