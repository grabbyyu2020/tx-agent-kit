import type {
  ShadowingCaptionKind,
  ShadowingExplanation,
  ShadowingFailureReason,
  ShadowingVideoStatus
} from '@tx-agent-kit/contracts'
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { Effect, Either, Option, Schema } from 'effect'
import type { DbClient } from '../client.js'
import { shadowingSegmentRowSchema } from '../effect-schemas/shadowing-segments.js'
import { shadowingSentenceRowSchema, type ShadowingSentenceRowShape } from '../effect-schemas/shadowing-sentences.js'
import { shadowingVideoRowSchema } from '../effect-schemas/shadowing-videos.js'
import { dbDecodeFailed, dbQueryFailed } from '../errors.js'
import { shadowingSegments, shadowingSentences, shadowingVideos } from '../schema.js'
import { insertDomainEventInTransaction } from './domain-events.js'
import { withDb } from './repo-helpers.js'

/** A video row plus `explainedCount` (sentences whose explanation is `ready`), computed in SQL. */
export const shadowingVideoRecordSchema = Schema.extend(
  shadowingVideoRowSchema,
  Schema.Struct({ explainedCount: Schema.Int })
)
export type ShadowingVideoRecordShape = Schema.Schema.Type<typeof shadowingVideoRecordSchema>

export interface ShadowingVideoDetailShape {
  readonly video: ShadowingVideoRecordShape
  readonly sentences: ReadonlyArray<ShadowingSentenceRowShape>
  readonly segments: ReadonlyArray<Schema.Schema.Type<typeof shadowingSegmentRowSchema>>
}

export interface InsertShadowingVideoInput {
  readonly userId: string
  readonly youtubeVideoId: string
}

export interface ShadowingVideoMetadataInput {
  readonly title: string
  readonly thumbnailUrl: string | null
  readonly durationSeconds: number | null
  readonly captionKind: ShadowingCaptionKind
}

export interface NewShadowingSentenceInput {
  readonly sentenceIndex: number
  readonly batchIndex: number
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

export interface NewShadowingSegmentInput {
  readonly segmentIndex: number
  readonly sentenceIndex: number
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

export interface ShadowingVideoFailureInput {
  readonly reason: ShadowingFailureReason
  readonly message: string
}

type DbExecutor = Pick<DbClient, 'select'>

const decodeVideoRecords = Schema.decodeUnknown(Schema.Array(shadowingVideoRecordSchema))
const decodeSentenceRows = Schema.decodeUnknown(Schema.Array(shadowingSentenceRowSchema))
const decodeSegmentRows = Schema.decodeUnknown(Schema.Array(shadowingSegmentRowSchema))

// Postgres caps bind parameters at 65535 per statement; 8 columns × 1000 rows stays well below.
const insertChunkSize = 1000

const chunk = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: A[][] = []
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size))
  }
  return chunks
}

// Explicit alias + table-qualified outer reference: drizzle renders column
// interpolations inside select fields unqualified, which would bind `id` to the
// inner table.
const explainedCountColumn = sql<number>`(
  SELECT count(*)::int
    FROM ${shadowingSentences} AS explained
   WHERE explained.video_id = ${shadowingVideos}.id
     AND explained.explanation_status = 'ready'
)`

const videoRecordColumns = {
  id: shadowingVideos.id,
  userId: shadowingVideos.userId,
  youtubeVideoId: shadowingVideos.youtubeVideoId,
  title: shadowingVideos.title,
  thumbnailUrl: shadowingVideos.thumbnailUrl,
  durationSeconds: shadowingVideos.durationSeconds,
  captionKind: shadowingVideos.captionKind,
  status: shadowingVideos.status,
  failureReason: shadowingVideos.failureReason,
  failureMessage: shadowingVideos.failureMessage,
  sentenceCount: shadowingVideos.sentenceCount,
  lastSegmentIndex: shadowingVideos.lastSegmentIndex,
  createdAt: shadowingVideos.createdAt,
  updatedAt: shadowingVideos.updatedAt,
  explainedCount: explainedCountColumn
} as const

const selectVideoRecords = (executor: DbExecutor, where: SQL | undefined) =>
  Effect.gen(function* () {
    const rows = yield* executor
      .select(videoRecordColumns)
      .from(shadowingVideos)
      .where(where)
      .orderBy(desc(shadowingVideos.createdAt), desc(shadowingVideos.id))
      .execute()
    return yield* decodeVideoRecords(rows).pipe(
      Effect.mapError((error) => dbDecodeFailed('shadowing video rows decode failed', error))
    )
  })

const selectFirstVideoRecord = (executor: DbExecutor, where: SQL | undefined) =>
  selectVideoRecords(executor, where).pipe(Effect.map((rows) => Option.fromNullable(rows[0])))

const selectSentences = (executor: DbExecutor, videoId: string) =>
  Effect.gen(function* () {
    const rows = yield* executor
      .select()
      .from(shadowingSentences)
      .where(eq(shadowingSentences.videoId, videoId))
      .orderBy(asc(shadowingSentences.sentenceIndex))
      .execute()
    return yield* decodeSentenceRows(rows).pipe(
      Effect.mapError((error) => dbDecodeFailed('shadowing sentence rows decode failed', error))
    )
  })

const insertImportRequestedEvent = (
  trx: Pick<DbClient, 'insert'>,
  input: { videoId: string; userId: string }
) =>
  insertDomainEventInTransaction(trx, {
    eventType: 'shadowing.video_import_requested',
    aggregateType: 'shadowing',
    aggregateId: input.videoId,
    payload: { videoId: input.videoId, userId: input.userId }
  })

export const shadowingRepository = {
  findVideoForUser: (userId: string, videoId: string) =>
    withDb('Failed to fetch shadowing video', (db) =>
      selectFirstVideoRecord(db, and(eq(shadowingVideos.userId, userId), eq(shadowingVideos.id, videoId)))
    ),

  findVideoByYoutubeId: (userId: string, youtubeVideoId: string) =>
    withDb('Failed to fetch shadowing video by YouTube id', (db) =>
      selectFirstVideoRecord(
        db,
        and(eq(shadowingVideos.userId, userId), eq(shadowingVideos.youtubeVideoId, youtubeVideoId))
      )
    ),

  /**
   * Insert an `importing` video and its `shadowing.video_import_requested`
   * outbox event in one transaction. When the (user, YouTube id) row already
   * exists (re-submit or a concurrent insert) the existing row is returned with
   * `created: false` and no event is written.
   *
   * @spec INV-SHADOW-001
   */
  insertVideoWithImportEvent: (input: InsertShadowingVideoInput) =>
    withDb('Failed to insert shadowing video', (db) =>
      db.transaction((trx) =>
        Effect.gen(function* () {
          const inserted = yield* trx
            .insert(shadowingVideos)
            .values({ userId: input.userId, youtubeVideoId: input.youtubeVideoId, status: 'importing' })
            .onConflictDoNothing({ target: [shadowingVideos.userId, shadowingVideos.youtubeVideoId] })
            .returning({ id: shadowingVideos.id })
            .execute()

          const insertedId = inserted[0]?.id
          if (insertedId !== undefined) {
            yield* insertImportRequestedEvent(trx, { videoId: insertedId, userId: input.userId })
          }

          const video = yield* selectFirstVideoRecord(
            trx,
            insertedId !== undefined
              ? eq(shadowingVideos.id, insertedId)
              : and(eq(shadowingVideos.userId, input.userId), eq(shadowingVideos.youtubeVideoId, input.youtubeVideoId))
          )
          if (Option.isNone(video)) {
            return yield* Effect.fail(
              dbQueryFailed('shadowing video missing after insert', new Error('no row for (user, youtube id)'))
            )
          }
          return { video: video.value, created: insertedId !== undefined }
        })
      )
    ),

  /** Newest first, with `explainedCount` computed in SQL. */
  listVideosForUser: (userId: string) =>
    withDb('Failed to list shadowing videos', (db) =>
      selectVideoRecords(db, eq(shadowingVideos.userId, userId))
    ),

  /** Video + sentences (by sentence index) + segments (by segment index); none when the video is missing. */
  getVideoDetail: (videoId: string) =>
    withDb('Failed to fetch shadowing video detail', (db) =>
      Effect.gen(function* () {
        const video = yield* selectFirstVideoRecord(db, eq(shadowingVideos.id, videoId))
        if (Option.isNone(video)) {
          return Option.none<ShadowingVideoDetailShape>()
        }
        const sentences = yield* selectSentences(db, videoId)
        const segmentRows = yield* db
          .select()
          .from(shadowingSegments)
          .where(eq(shadowingSegments.videoId, videoId))
          .orderBy(asc(shadowingSegments.segmentIndex))
          .execute()
        const segments = yield* decodeSegmentRows(segmentRows).pipe(
          Effect.mapError((error) => dbDecodeFailed('shadowing segment rows decode failed', error))
        )
        return Option.some<ShadowingVideoDetailShape>({ video: video.value, sentences, segments })
      })
    ),

  /** Deletes the video; sentences and segments go by cascade (INV-SHADOW-017). Returns whether a row was deleted. */
  deleteVideo: (videoId: string) =>
    withDb('Failed to delete shadowing video', (db) =>
      Effect.gen(function* () {
        const deleted = yield* db
          .delete(shadowingVideos)
          .where(eq(shadowingVideos.id, videoId))
          .returning({ id: shadowingVideos.id })
          .execute()
        return deleted.length > 0
      })
    ),

  /** Only from `failed`: back to `importing`, failure cleared, new import event — one transaction. */
  resetVideoForRetry: (videoId: string) =>
    withDb('Failed to reset shadowing video for retry', (db) =>
      db.transaction((trx) =>
        Effect.gen(function* () {
          const updated = yield* trx
            .update(shadowingVideos)
            .set({ status: 'importing', failureReason: null, failureMessage: null, updatedAt: sql`now()` })
            .where(and(eq(shadowingVideos.id, videoId), eq(shadowingVideos.status, 'failed')))
            .returning({ id: shadowingVideos.id, userId: shadowingVideos.userId })
            .execute()

          const row = updated[0]
          if (!row) {
            return Option.none<ShadowingVideoRecordShape>()
          }

          yield* insertImportRequestedEvent(trx, { videoId: row.id, userId: row.userId })
          return yield* selectFirstVideoRecord(trx, eq(shadowingVideos.id, row.id))
        })
      )
    ),

  /** Stores the resume position; returns false (nothing written) when `segmentIndex` is not an existing segment. */
  saveProgress: (videoId: string, segmentIndex: number) =>
    withDb('Failed to save shadowing progress', (db) =>
      Effect.gen(function* () {
        const updated = yield* db
          .update(shadowingVideos)
          .set({ lastSegmentIndex: segmentIndex, updatedAt: sql`now()` })
          .where(and(
            eq(shadowingVideos.id, videoId),
            sql`${segmentIndex} >= 0`,
            sql`${segmentIndex} < (
              SELECT count(*)::int FROM ${shadowingSegments} AS seg WHERE seg.video_id = ${videoId}
            )`
          ))
          .returning({ id: shadowingVideos.id })
          .execute()
        return updated.length > 0
      })
    ),

  /**
   * Marks the pending sentences of the batch containing `sentenceIndex` as
   * requested now, so the import workflow picks that batch next (Decision 1).
   * Returns the number of sentences touched.
   */
  prioritizeBatchOfSentence: (videoId: string, sentenceIndex: number) =>
    withDb('Failed to prioritize shadowing explanation batch', (db) =>
      Effect.gen(function* () {
        const updated = yield* db
          .update(shadowingSentences)
          .set({ explanationRequestedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(
            eq(shadowingSentences.videoId, videoId),
            eq(shadowingSentences.explanationStatus, 'pending'),
            sql`${shadowingSentences.batchIndex} = (
              SELECT s.batch_index FROM ${shadowingSentences} AS s
               WHERE s.video_id = ${videoId} AND s.sentence_index = ${sentenceIndex}
            )`
          ))
          .returning({ id: shadowingSentences.id })
          .execute()
        return updated.length
      })
    ),

  /**
   * Only from `ready` or `failed`: sets `regenerating` and writes
   * `shadowing.explanation_regenerate_requested` in the same transaction.
   * The previous explanation is kept until the regeneration finishes.
   *
   * @spec INV-SHADOW-012
   */
  markSentenceRegenerating: (videoId: string, sentenceIndex: number) =>
    withDb('Failed to mark shadowing sentence regenerating', (db) =>
      db.transaction((trx) =>
        Effect.gen(function* () {
          const updated = yield* trx
            .update(shadowingSentences)
            .set({ explanationStatus: 'regenerating', updatedAt: sql`now()` })
            .where(and(
              eq(shadowingSentences.videoId, videoId),
              eq(shadowingSentences.sentenceIndex, sentenceIndex),
              inArray(shadowingSentences.explanationStatus, ['ready', 'failed'])
            ))
            .returning()
            .execute()

          if (updated.length === 0) {
            return Option.none<ShadowingSentenceRowShape>()
          }

          const [sentence] = yield* decodeSentenceRows(updated).pipe(
            Effect.mapError((error) => dbDecodeFailed('shadowing sentence row decode failed', error))
          )
          if (!sentence) {
            return Option.none<ShadowingSentenceRowShape>()
          }

          yield* insertDomainEventInTransaction(trx, {
            eventType: 'shadowing.explanation_regenerate_requested',
            aggregateType: 'shadowing',
            aggregateId: videoId,
            payload: { videoId, sentenceId: sentence.id }
          })
          return Option.some(sentence)
        })
      )
    ),

  updateVideoMetadata: (videoId: string, metadata: ShadowingVideoMetadataInput) =>
    withDb('Failed to update shadowing video metadata', (db) =>
      Effect.gen(function* () {
        yield* db
          .update(shadowingVideos)
          .set({
            title: metadata.title,
            thumbnailUrl: metadata.thumbnailUrl,
            durationSeconds: metadata.durationSeconds,
            captionKind: metadata.captionKind,
            updatedAt: sql`now()`
          })
          .where(eq(shadowingVideos.id, videoId))
          .execute()
      })
    ),

  /**
   * In ONE transaction: delete the video's segments and sentences, insert the
   * new sentences (pending) and segments (linked by sentence index), and set
   * `sentence_count` + status `explaining`. Re-running never duplicates rows.
   *
   * @spec INV-SHADOW-023
   */
  replaceTranscript: (
    videoId: string,
    sentences: ReadonlyArray<NewShadowingSentenceInput>,
    segments: ReadonlyArray<NewShadowingSegmentInput>
  ) =>
    withDb('Failed to replace shadowing transcript', (db) =>
      db.transaction((trx) =>
        Effect.gen(function* () {
          yield* trx.delete(shadowingSegments).where(eq(shadowingSegments.videoId, videoId)).execute()
          yield* trx.delete(shadowingSentences).where(eq(shadowingSentences.videoId, videoId)).execute()

          const sentenceIdByIndex = new Map<number, string>()
          for (const sentenceChunk of chunk(sentences, insertChunkSize)) {
            const inserted = yield* trx
              .insert(shadowingSentences)
              .values(sentenceChunk.map((sentence) => ({
                videoId,
                sentenceIndex: sentence.sentenceIndex,
                batchIndex: sentence.batchIndex,
                text: sentence.text,
                startMs: sentence.startMs,
                endMs: sentence.endMs,
                explanationStatus: 'pending' as const
              })))
              .returning({ id: shadowingSentences.id, sentenceIndex: shadowingSentences.sentenceIndex })
              .execute()
            for (const row of inserted) {
              sentenceIdByIndex.set(row.sentenceIndex, row.id)
            }
          }

          const segmentValues: Array<typeof shadowingSegments.$inferInsert> = []
          for (const segment of segments) {
            const sentenceId = sentenceIdByIndex.get(segment.sentenceIndex)
            if (sentenceId === undefined) {
              return yield* Effect.fail(
                dbQueryFailed(
                  'shadowing segment references an unknown sentence',
                  new Error(`segment ${segment.segmentIndex} references sentence ${segment.sentenceIndex}`)
                )
              )
            }
            segmentValues.push({
              videoId,
              sentenceId,
              segmentIndex: segment.segmentIndex,
              sentenceIndex: segment.sentenceIndex,
              text: segment.text,
              startMs: segment.startMs,
              endMs: segment.endMs
            })
          }
          for (const segmentChunk of chunk(segmentValues, insertChunkSize)) {
            yield* trx.insert(shadowingSegments).values([...segmentChunk]).execute()
          }

          yield* trx
            .update(shadowingVideos)
            .set({
              sentenceCount: sentences.length,
              status: 'explaining',
              failureReason: null,
              failureMessage: null,
              updatedAt: sql`now()`
            })
            .where(eq(shadowingVideos.id, videoId))
            .execute()
        })
      )
    ),

  /**
   * `failed` requires `failure` (stored as failure_reason + failure_message);
   * every other status clears both fields.
   */
  setVideoStatus: (videoId: string, status: ShadowingVideoStatus, failure?: ShadowingVideoFailureInput) =>
    withDb('Failed to set shadowing video status', (db) =>
      Effect.gen(function* () {
        if (status === 'failed' && failure === undefined) {
          return yield* Effect.fail(
            dbQueryFailed('shadowing video failed status requires a failure reason', new Error('missing failure'))
          )
        }
        const isFailed = status === 'failed'
        yield* db
          .update(shadowingVideos)
          .set({
            status,
            failureReason: isFailed ? failure?.reason ?? null : null,
            failureMessage: isFailed ? failure?.message ?? null : null,
            updatedAt: sql`now()`
          })
          .where(eq(shadowingVideos.id, videoId))
          .execute()
      })
    ),

  /**
   * The batch to explain next: among pending sentences, the batch with the
   * latest `explanation_requested_at` first, otherwise the lowest batch index.
   *
   * @spec INV-SHADOW-007
   */
  nextPendingBatchIndex: (videoId: string) =>
    withDb('Failed to select next shadowing explanation batch', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ batchIndex: shadowingSentences.batchIndex })
          .from(shadowingSentences)
          .where(and(
            eq(shadowingSentences.videoId, videoId),
            eq(shadowingSentences.explanationStatus, 'pending')
          ))
          .groupBy(shadowingSentences.batchIndex)
          .orderBy(
            sql`max(${shadowingSentences.explanationRequestedAt}) DESC NULLS LAST`,
            asc(shadowingSentences.batchIndex)
          )
          .limit(1)
          .execute()
        return Option.fromNullable(rows[0]?.batchIndex)
      })
    ),

  listSentences: (videoId: string) =>
    withDb('Failed to list shadowing sentences', (db) => selectSentences(db, videoId)),

  /**
   * Stores explanations for sentences of `batchIndex` that are still `pending`
   * (sentences moved to another status meanwhile are left alone). Returns the
   * number of sentences stored.
   *
   * @spec INV-SHADOW-012
   */
  storeExplanations: (
    videoId: string,
    batchIndex: number,
    explanations: ReadonlyMap<number, ShadowingExplanation>
  ) =>
    withDb('Failed to store shadowing explanations', (db) =>
      db.transaction((trx) =>
        Effect.gen(function* () {
          let stored = 0
          for (const [sentenceIndex, explanation] of explanations) {
            const updated = yield* trx
              .update(shadowingSentences)
              .set({ explanation, explanationStatus: 'ready', updatedAt: sql`now()` })
              .where(and(
                eq(shadowingSentences.videoId, videoId),
                eq(shadowingSentences.batchIndex, batchIndex),
                eq(shadowingSentences.sentenceIndex, sentenceIndex),
                eq(shadowingSentences.explanationStatus, 'pending')
              ))
              .returning({ id: shadowingSentences.id })
              .execute()
            stored += updated.length
          }
          return stored
        })
      )
    ),

  /** Pending sentences of the batch → `failed`. Returns the number of sentences touched. */
  markBatchFailed: (videoId: string, batchIndex: number) =>
    withDb('Failed to mark shadowing explanation batch failed', (db) =>
      Effect.gen(function* () {
        const updated = yield* db
          .update(shadowingSentences)
          .set({ explanationStatus: 'failed', updatedAt: sql`now()` })
          .where(and(
            eq(shadowingSentences.videoId, videoId),
            eq(shadowingSentences.batchIndex, batchIndex),
            eq(shadowingSentences.explanationStatus, 'pending')
          ))
          .returning({ id: shadowingSentences.id })
          .execute()
        return updated.length
      })
    ),

  /**
   * From `regenerating` only: Right(explanation) → `ready` with the new
   * explanation; Left(errorMessage) → `failed`, keeping the previous
   * explanation (the message is not persisted; the caller logs it).
   * Returns whether the sentence was updated.
   */
  finishRegeneration: (sentenceId: string, result: Either.Either<ShadowingExplanation, string>) =>
    withDb('Failed to finish shadowing explanation regeneration', (db) =>
      Effect.gen(function* () {
        const updated = yield* db
          .update(shadowingSentences)
          .set(
            Either.isRight(result)
              ? { explanation: result.right, explanationStatus: 'ready', updatedAt: sql`now()` }
              : { explanationStatus: 'failed', updatedAt: sql`now()` }
          )
          .where(and(
            eq(shadowingSentences.id, sentenceId),
            eq(shadowingSentences.explanationStatus, 'regenerating')
          ))
          .returning({ id: shadowingSentences.id })
          .execute()
        return updated.length > 0
      })
    )
}
