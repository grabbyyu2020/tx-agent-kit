import type { ShadowingExplanationStatus } from '@tx-agent-kit/contracts'
import { Effect, Either, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import type { CoreError } from '../../../errors.js'
import type {
  ShadowingSegmentRecord,
  ShadowingSentenceRecord,
  ShadowingVideoRecord
} from '../domain/shadowing-domain.js'
import { ShadowingLlmPort, ShadowingStorePort } from '../ports/shadowing-ports.js'
import { ShadowingService, ShadowingServiceLive } from './shadowing-service.js'

const owner = '00000000-0000-4000-8000-000000000001'
const stranger = '00000000-0000-4000-8000-000000000002'
const videoId = '00000000-0000-4000-8000-0000000000a1'
const fixedDate = new Date('2026-11-01T00:00:00.000Z')

const makeVideo = (overrides: Partial<ShadowingVideoRecord> = {}): ShadowingVideoRecord => ({
  id: videoId,
  userId: owner,
  youtubeVideoId: 'dQw4w9WgXcQ',
  title: 'A talk',
  thumbnailUrl: null,
  durationSeconds: 120,
  captionKind: 'manual',
  status: 'explaining',
  failureReason: null,
  failureMessage: null,
  sentenceCount: 3,
  lastSegmentIndex: 0,
  createdAt: fixedDate,
  updatedAt: fixedDate,
  explainedCount: 0,
  ...overrides
})

const makeSentence = (
  sentenceIndex: number,
  explanationStatus: ShadowingExplanationStatus = 'pending'
): ShadowingSentenceRecord => ({
  id: `00000000-0000-4000-8000-0000000001${String(sentenceIndex).padStart(2, '0')}`,
  videoId,
  sentenceIndex,
  batchIndex: 0,
  text: `Sentence ${sentenceIndex}.`,
  startMs: sentenceIndex * 1000,
  endMs: sentenceIndex * 1000 + 900,
  explanation: null,
  explanationStatus,
  explanationRequestedAt: null,
  updatedAt: fixedDate
})

const makeSegment = (segmentIndex: number): ShadowingSegmentRecord => ({
  id: `00000000-0000-4000-8000-0000000002${String(segmentIndex).padStart(2, '0')}`,
  videoId,
  sentenceId: makeSentence(segmentIndex).id,
  segmentIndex,
  sentenceIndex: segmentIndex,
  text: `Sentence ${segmentIndex}.`,
  startMs: segmentIndex * 1000,
  endMs: segmentIndex * 1000 + 900
})

type FakeState = {
  videos: ShadowingVideoRecord[]
  sentences: ShadowingSentenceRecord[]
  segments: ShadowingSegmentRecord[]
  writes: string[]
  llmCalls: number
}

const makeState = (overrides: Partial<FakeState> = {}): FakeState => ({
  videos: [makeVideo()],
  sentences: [makeSentence(0, 'ready'), makeSentence(1, 'pending'), makeSentence(2, 'regenerating')],
  segments: [makeSegment(0), makeSegment(1), makeSegment(2)],
  writes: [],
  llmCalls: 0,
  ...overrides
})

const runEffectPromise = Effect.runPromise

const unused = () => Effect.die('unused store method')

const fakeStoreImpl = (state: FakeState): ShadowingStorePort['Type'] => ({
    findVideoForUser: (userId, id) =>
      Effect.sync(() => Option.fromNullable(state.videos.find((v) => v.id === id && v.userId === userId))),
    findVideoByYoutubeId: (userId, youtubeVideoId) =>
      Effect.sync(() =>
        Option.fromNullable(state.videos.find((v) => v.userId === userId && v.youtubeVideoId === youtubeVideoId))
      ),
    insertVideoWithImportEvent: (input) =>
      Effect.sync(() => {
        state.writes.push(`insert:${input.youtubeVideoId}`)
        const video = makeVideo({
          id: '00000000-0000-4000-8000-0000000000b2',
          userId: input.userId,
          youtubeVideoId: input.youtubeVideoId,
          status: 'importing',
          sentenceCount: 0
        })
        state.videos.push(video)
        return { video, created: true }
      }),
    listVideosForUser: (userId) => Effect.sync(() => state.videos.filter((v) => v.userId === userId)),
    getVideoDetail: (id) =>
      Effect.sync(() =>
        Option.map(Option.fromNullable(state.videos.find((v) => v.id === id)), (video) => ({
          video,
          sentences: state.sentences.filter((s) => s.videoId === id),
          segments: state.segments.filter((s) => s.videoId === id)
        }))
      ),
    deleteVideo: (id) =>
      Effect.sync(() => {
        state.writes.push(`delete:${id}`)
        const before = state.videos.length
        state.videos = state.videos.filter((v) => v.id !== id)
        return state.videos.length < before
      }),
    resetVideoForRetry: (id) =>
      Effect.sync(() => {
        const video = state.videos.find((v) => v.id === id && v.status === 'failed')
        if (!video) {
          return Option.none()
        }
        state.writes.push(`retry:${id}`)
        const reset = { ...video, status: 'importing' as const, failureReason: null, failureMessage: null }
        state.videos = state.videos.map((v) => (v.id === id ? reset : v))
        return Option.some(reset)
      }),
    saveProgress: (id, segmentIndex) =>
      Effect.sync(() => {
        const inRange = segmentIndex >= 0 && segmentIndex < state.segments.filter((s) => s.videoId === id).length
        if (inRange) {
          state.writes.push(`progress:${segmentIndex}`)
        }
        return inRange
      }),
    prioritizeBatchOfSentence: (id, sentenceIndex) =>
      Effect.sync(() => {
        state.writes.push(`prioritize:${sentenceIndex}`)
        return state.sentences.filter((s) => s.videoId === id && s.explanationStatus === 'pending').length
      }),
    markSentenceRegenerating: (id, sentenceIndex) =>
      Effect.sync(() => {
        const sentence = state.sentences.find(
          (s) =>
            s.videoId === id &&
            s.sentenceIndex === sentenceIndex &&
            (s.explanationStatus === 'ready' || s.explanationStatus === 'failed')
        )
        if (!sentence) {
          return Option.none()
        }
        state.writes.push(`regenerate:${sentenceIndex}`)
        const updated = { ...sentence, explanationStatus: 'regenerating' as const }
        state.sentences = state.sentences.map((s) => (s.id === sentence.id ? updated : s))
        return Option.some(updated)
      }),
    listSentences: (id) => Effect.sync(() => state.sentences.filter((s) => s.videoId === id)),
    findSentenceById: unused,
    updateVideoMetadata: unused,
    replaceTranscript: unused,
    setVideoStatus: unused,
    nextPendingBatchIndex: unused,
    storeExplanations: unused,
    markBatchFailed: unused,
    finishRegeneration: unused
  })

const fakeStore = (state: FakeState) => Layer.succeed(ShadowingStorePort, fakeStoreImpl(state))

// Provided to prove read paths never reach the LLM: every call is counted.
const countingLlm = (state: FakeState) =>
  Layer.succeed(ShadowingLlmPort, {
    segmentSentences: () =>
      Effect.sync(() => {
        state.llmCalls += 1
        return []
      }),
    explainSentences: () =>
      Effect.sync(() => {
        state.llmCalls += 1
        return new Map()
      })
  })

const run = <A>(
  state: FakeState,
  use: (service: ShadowingService['Type']) => Effect.Effect<A, CoreError, ShadowingStorePort>
): Promise<Either.Either<A, CoreError>> =>
  runEffectPromise(
    Effect.gen(function* () {
      const service = yield* ShadowingService
      return yield* use(service)
    }).pipe(
      Effect.either,
      Effect.provide(Layer.mergeAll(ShadowingServiceLive, fakeStore(state), countingLlm(state)))
    )
  )

const errorCode = <A>(result: Either.Either<A, CoreError>): string | null =>
  Either.isLeft(result) ? result.left.code : null

describe('ShadowingService.importVideo', () => {
  it('rejects an unrecognisable URL with BAD_REQUEST and writes nothing [INV-SHADOW-002]', async () => {
    const state = makeState({ videos: [] })
    const result = await run(state, (s) => s.importVideo(owner, 'https://vimeo.com/123456'))

    expect(errorCode(result)).toBe('BAD_REQUEST')
    expect(Either.isLeft(result) && result.left.message).toBe('Not a recognisable YouTube video URL')
    expect(state.writes).toEqual([])
    expect(state.videos).toEqual([])
  })

  it('returns the existing video with created:false and no insert [INV-SHADOW-001]', async () => {
    const state = makeState()
    const result = await run(state, (s) => s.importVideo(owner, 'https://youtu.be/dQw4w9WgXcQ?t=42'))

    expect(Either.getOrThrow(result)).toEqual({ video: makeVideo(), created: false })
    expect(state.writes).toEqual([])
  })

  it('inserts a new importing video for an unseen YouTube id [INV-SHADOW-001]', async () => {
    const state = makeState()
    const result = await run(state, (s) => s.importVideo(owner, 'https://www.youtube.com/watch?v=abcdefghijk'))

    const imported = Either.getOrThrow(result)
    expect(imported.created).toBe(true)
    expect(imported.video).toMatchObject({ userId: owner, youtubeVideoId: 'abcdefghijk', status: 'importing' })
    expect(state.writes).toEqual(['insert:abcdefghijk'])
  })

  it('imports per user: another user submitting the same video gets their own row [INV-SHADOW-018]', async () => {
    const state = makeState()
    const result = await run(state, (s) => s.importVideo(stranger, 'https://youtu.be/dQw4w9WgXcQ'))

    expect(Either.getOrThrow(result)).toMatchObject({ created: true, video: { userId: stranger } })
  })
})

describe('ShadowingService reads', () => {
  it('lists only the caller’s videos [INV-SHADOW-016]', async () => {
    const state = makeState({ videos: [makeVideo(), makeVideo({ id: 'other', userId: stranger })] })
    const result = await run(state, (s) => s.listVideos(owner))

    expect(Either.getOrThrow(result).map((v) => v.id)).toEqual([videoId])
  })

  it('returns the stored detail from the database and never calls the LLM [INV-SHADOW-013]', async () => {
    const state = makeState()
    const result = await run(state, (s) => s.getVideo(owner, videoId))

    const detail = Either.getOrThrow(result)
    expect(detail.video.id).toBe(videoId)
    expect(detail.sentences.map((s) => s.sentenceIndex)).toEqual([0, 1, 2])
    expect(detail.segments.map((s) => s.segmentIndex)).toEqual([0, 1, 2])
    expect(state.llmCalls).toBe(0)
  })
})

describe('ShadowingService ownership', () => {
  const foreignCases: ReadonlyArray<
    readonly [string, (s: ShadowingService['Type'], userId: string) => Effect.Effect<unknown, CoreError, ShadowingStorePort>]
  > = [
    ['getVideo', (s, userId) => s.getVideo(userId, videoId)],
    ['deleteVideo', (s, userId) => s.deleteVideo(userId, videoId)],
    ['retryImport', (s, userId) => s.retryImport(userId, videoId)],
    ['saveProgress', (s, userId) => s.saveProgress(userId, videoId, 1)],
    ['prioritizeSentence', (s, userId) => s.prioritizeSentence(userId, videoId, 1)],
    ['regenerateExplanation', (s, userId) => s.regenerateExplanation(userId, videoId, 0)]
  ]

  it.each(foreignCases)('%s: a video owned by another user is NOT_FOUND exactly like a missing one and nothing is written [INV-SHADOW-018]', async (_name, call) => {
    const foreignState = makeState({ videos: [makeVideo({ status: 'failed' })] })
    const missingState = makeState({ videos: [] })

    const foreign = await run(foreignState, (s) => call(s, stranger))
    const missing = await run(missingState, (s) => call(s, owner))

    expect(errorCode(foreign)).toBe('NOT_FOUND')
    expect(errorCode(missing)).toBe('NOT_FOUND')
    expect(Either.isLeft(foreign) && foreign.left.message).toBe(Either.isLeft(missing) && missing.left.message)
    expect(foreignState.writes).toEqual([])
  })
})

describe('ShadowingService writes', () => {
  it('deletes the caller’s video', async () => {
    const state = makeState()
    expect(Either.isRight(await run(state, (s) => s.deleteVideo(owner, videoId)))).toBe(true)
    expect(state.videos).toEqual([])
  })

  it('retry is a CONFLICT unless the video failed; a failed video is reset to importing [INV-SHADOW-021]', async () => {
    for (const status of ['importing', 'explaining', 'ready'] as const) {
      const state = makeState({ videos: [makeVideo({ status })] })
      expect(errorCode(await run(state, (s) => s.retryImport(owner, videoId)))).toBe('CONFLICT')
      expect(state.writes).toEqual([])
    }

    const state = makeState({
      videos: [makeVideo({ status: 'failed', failureReason: 'import_error', failureMessage: 'yt-dlp exited 1' })]
    })
    const result = await run(state, (s) => s.retryImport(owner, videoId))
    expect(Either.getOrThrow(result)).toMatchObject({ status: 'importing', failureReason: null, failureMessage: null })
    expect(state.writes).toEqual([`retry:${videoId}`])
  })

  it('saveProgress stores an existing segment index and rejects one out of range with BAD_REQUEST', async () => {
    const state = makeState()
    expect(Either.isRight(await run(state, (s) => s.saveProgress(owner, videoId, 2)))).toBe(true)
    expect(errorCode(await run(state, (s) => s.saveProgress(owner, videoId, 3)))).toBe('BAD_REQUEST')
    expect(errorCode(await run(state, (s) => s.saveProgress(owner, videoId, -1)))).toBe('BAD_REQUEST')
    expect(state.writes).toEqual(['progress:2'])
  })

  it('prioritizeSentence requires an existing sentence and succeeds even when nothing is pending [INV-SHADOW-007]', async () => {
    const state = makeState()
    expect(errorCode(await run(state, (s) => s.prioritizeSentence(owner, videoId, 3)))).toBe('NOT_FOUND')
    expect(state.writes).toEqual([])

    expect(Either.isRight(await run(state, (s) => s.prioritizeSentence(owner, videoId, 1)))).toBe(true)
    const settled = makeState({ sentences: [makeSentence(0, 'ready'), makeSentence(1, 'ready'), makeSentence(2, 'ready')] })
    expect(Either.isRight(await run(settled, (s) => s.prioritizeSentence(owner, videoId, 0)))).toBe(true)
  })

  it('regenerateExplanation: missing sentence NOT_FOUND, pending/regenerating CONFLICT, ready/failed → regenerating [INV-SHADOW-012]', async () => {
    const state = makeState({
      sentences: [
        makeSentence(0, 'ready'),
        makeSentence(1, 'pending'),
        makeSentence(2, 'regenerating'),
        makeSentence(3, 'failed')
      ]
    })

    expect(errorCode(await run(state, (s) => s.regenerateExplanation(owner, videoId, 9)))).toBe('NOT_FOUND')
    expect(errorCode(await run(state, (s) => s.regenerateExplanation(owner, videoId, 1)))).toBe('CONFLICT')
    expect(errorCode(await run(state, (s) => s.regenerateExplanation(owner, videoId, 2)))).toBe('CONFLICT')
    expect(state.writes).toEqual([])

    const ready = Either.getOrThrow(await run(state, (s) => s.regenerateExplanation(owner, videoId, 0)))
    const failed = Either.getOrThrow(await run(state, (s) => s.regenerateExplanation(owner, videoId, 3)))
    expect([ready.explanationStatus, failed.explanationStatus]).toEqual(['regenerating', 'regenerating'])
    expect(state.writes).toEqual(['regenerate:0', 'regenerate:3'])
    // A second request while regenerating is a conflict.
    expect(errorCode(await run(state, (s) => s.regenerateExplanation(owner, videoId, 0)))).toBe('CONFLICT')
  })

  it('maps store failures to INTERNAL_ERROR', async () => {
    const failingStore = Layer.succeed(ShadowingStorePort, {
      ...fakeStoreImpl(makeState()),
      listVideosForUser: () => Effect.fail(new Error('connection refused'))
    })
    const result = await runEffectPromise(
      Effect.gen(function* () {
        const service = yield* ShadowingService
        return yield* service.listVideos(owner)
      }).pipe(Effect.either, Effect.provide(Layer.merge(ShadowingServiceLive, failingStore)))
    )
    expect(errorCode(result)).toBe('INTERNAL_ERROR')
  })
})
