import type { ShadowingExplanation, ShadowingExplanationStatus, ShadowingVideoStatus } from '@tx-agent-kit/contracts'
import { Effect, Either, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import type { CaptionWord } from '../domain/caption-transcript.js'
import { batchIndexOf } from '../domain/explanation.js'
import type {
  NewShadowingSegmentInput,
  NewShadowingSentenceInput,
  ShadowingSentenceRecord,
  ShadowingVideoFailureInput,
  ShadowingVideoMetadataInput,
  ShadowingVideoRecord
} from '../domain/shadowing-domain.js'
import {
  CaptionSourceError,
  classifyShadowingImportError,
  LlmCallError,
  LlmNotConfiguredError,
  NoCaptionsError,
  NotEmbeddableError,
  type ShadowingImportError
} from '../domain/shadowing-errors.js'
import {
  CaptionSourcePort,
  ShadowingLlmPort,
  ShadowingStorePort,
  type ExplainBatchInput,
  type ShadowingVideoSource
} from '../ports/shadowing-ports.js'
import { ShadowingImportService, ShadowingImportServiceLive } from './shadowing-import-service.js'

const videoId = '00000000-0000-4000-8000-0000000000a1'
const fixedDate = new Date('2026-11-01T00:00:00.000Z')

const makeVideo = (overrides: Partial<ShadowingVideoRecord> = {}): ShadowingVideoRecord => ({
  id: videoId,
  userId: '00000000-0000-4000-8000-000000000001',
  youtubeVideoId: 'dQw4w9WgXcQ',
  title: 'Imported title',
  thumbnailUrl: null,
  durationSeconds: null,
  captionKind: null,
  status: 'importing',
  failureReason: null,
  failureMessage: null,
  sentenceCount: 0,
  lastSegmentIndex: 0,
  createdAt: fixedDate,
  updatedAt: fixedDate,
  explainedCount: 0,
  ...overrides
})

const sentenceText = (index: number): string => `Sentence ${index}.`

const makeSentence = (
  sentenceIndex: number,
  explanationStatus: ShadowingExplanationStatus = 'pending'
): ShadowingSentenceRecord => ({
  id: `sentence-${sentenceIndex}`,
  videoId,
  sentenceIndex,
  batchIndex: batchIndexOf(sentenceIndex),
  text: sentenceText(sentenceIndex),
  startMs: sentenceIndex * 1000,
  endMs: sentenceIndex * 1000 + 900,
  explanation: null,
  explanationStatus,
  explanationRequestedAt: null,
  updatedAt: fixedDate
})

const explanationFor = (index: number): ShadowingExplanation => ({
  meaning: `意思 ${index}`,
  keyExpressions: [],
  toneAndContext: '中性'
})

type FakeState = {
  video: ShadowingVideoRecord | null
  sentences: ShadowingSentenceRecord[]
  metadata: ShadowingVideoMetadataInput[]
  transcripts: Array<{ sentences: ReadonlyArray<NewShadowingSentenceInput>; segments: ReadonlyArray<NewShadowingSegmentInput> }>
  statuses: Array<{ status: ShadowingVideoStatus; failure: ShadowingVideoFailureInput | undefined }>
  stored: Array<{ batchIndex: number; indexes: number[] }>
  failedBatches: number[]
  finished: Array<{ sentenceId: string; result: Either.Either<ShadowingExplanation, string> }>
  fetches: string[]
  segmentCalls: Array<{ title: string; words: ReadonlyArray<string> }>
  explainCalls: ExplainBatchInput[]
  nextBatch: Option.Option<number>
}

const makeState = (overrides: Partial<FakeState> = {}): FakeState => ({
  video: makeVideo(),
  sentences: [],
  metadata: [],
  transcripts: [],
  statuses: [],
  stored: [],
  failedBatches: [],
  finished: [],
  fetches: [],
  segmentCalls: [],
  explainCalls: [],
  nextBatch: Option.none(),
  ...overrides
})

const runEffectPromise = Effect.runPromise

const unused = () => Effect.die('unused store method')

const fakeStore = (state: FakeState) =>
  Layer.succeed(ShadowingStorePort, {
    getVideoDetail: (id) =>
      Effect.sync(() =>
        state.video?.id === id
          ? Option.some({ video: state.video, sentences: state.sentences, segments: [] })
          : Option.none()
      ),
    updateVideoMetadata: (_id, metadata) => Effect.sync(() => void state.metadata.push(metadata)),
    replaceTranscript: (_id, sentences, segments) => Effect.sync(() => void state.transcripts.push({ sentences, segments })),
    setVideoStatus: (id, status, failure) =>
      Effect.sync(() => {
        if (state.video?.id !== id) {
          return
        }
        state.statuses.push({ status, failure })
        state.video = { ...state.video, status }
      }),
    nextPendingBatchIndex: () => Effect.sync(() => state.nextBatch),
    listSentences: () => Effect.sync(() => state.sentences),
    storeExplanations: (_id, batchIndex, explanations) =>
      Effect.sync(() => {
        state.stored.push({ batchIndex, indexes: [...explanations.keys()] })
        return explanations.size
      }),
    markBatchFailed: (_id, batchIndex) =>
      Effect.sync(() => {
        state.failedBatches.push(batchIndex)
        return 1
      }),
    findSentenceById: (sentenceId) => Effect.sync(() => Option.fromNullable(state.sentences.find((s) => s.id === sentenceId))),
    finishRegeneration: (sentenceId, result) =>
      Effect.sync(() => {
        state.finished.push({ sentenceId, result })
        return true
      }),
    findVideoForUser: unused,
    findVideoByYoutubeId: unused,
    insertVideoWithImportEvent: unused,
    listVideosForUser: unused,
    deleteVideo: unused,
    resetVideoForRetry: unused,
    saveProgress: unused,
    prioritizeBatchOfSentence: unused,
    markSentenceRegenerating: unused
  })

type SourceBehaviour = Effect.Effect<ShadowingVideoSource, NoCaptionsError | NotEmbeddableError | CaptionSourceError>

const fakeCaptions = (state: FakeState, source: SourceBehaviour) =>
  Layer.succeed(CaptionSourcePort, {
    fetchVideoSource: (youtubeVideoId) =>
      Effect.suspend(() => {
        state.fetches.push(youtubeVideoId)
        return source
      })
  })

type LlmBehaviour = {
  segment?: (words: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>, LlmCallError | LlmNotConfiguredError>
  explain?: (input: ExplainBatchInput) => Effect.Effect<ReadonlyMap<number, ShadowingExplanation>, LlmCallError | LlmNotConfiguredError>
}

const fakeLlm = (state: FakeState, behaviour: LlmBehaviour) =>
  Layer.succeed(ShadowingLlmPort, {
    segmentSentences: (input) =>
      Effect.suspend(() => {
        state.segmentCalls.push(input)
        return behaviour.segment ? behaviour.segment(input.words) : Effect.die('unexpected segmentation')
      }),
    explainSentences: (input) =>
      Effect.suspend(() => {
        state.explainCalls.push(input)
        return behaviour.explain
          ? behaviour.explain(input)
          : Effect.succeed(new Map(input.targetIndexes.map((index) => [index, explanationFor(index)] as const)))
      })
  })

const run = <A>(
  state: FakeState,
  use: (
    service: ShadowingImportService['Type']
  ) => Effect.Effect<A, ShadowingImportError, ShadowingStorePort | CaptionSourcePort | ShadowingLlmPort>,
  options: { source?: SourceBehaviour; llm?: LlmBehaviour } = {}
): Promise<Either.Either<A, ShadowingImportError>> =>
  runEffectPromise(
    Effect.gen(function* () {
      const service = yield* ShadowingImportService
      return yield* use(service)
    }).pipe(
      Effect.either,
      Effect.provide(
        Layer.mergeAll(
          ShadowingImportServiceLive,
          fakeStore(state),
          fakeCaptions(state, options.source ?? Effect.die('unexpected caption fetch')),
          fakeLlm(state, options.llm ?? {})
        )
      )
    )
  )

// 45 sentences; sentence 0 has 40 words (forces several segments), the rest three words each.
// Words are 250 ms long with a 50 ms pause, except a 400 ms pause after every 10th word.
const buildCaptions = (sentenceCount: number) => {
  const words: CaptionWord[] = []
  const sentences: string[] = []
  let cursor = 0
  for (let s = 0; s < sentenceCount; s += 1) {
    const length = s === 0 ? 40 : 3
    const tokens: string[] = []
    for (let w = 0; w < length; w += 1) {
      const text = `w${s}x${w}`
      words.push({ text, startMs: cursor, endMs: cursor + 250 })
      cursor += (words.length % 10 === 0 ? 650 : 300)
      tokens.push(w === 0 ? text.toUpperCase() : text)
    }
    sentences.push(`${tokens.join(' ')}.`)
  }
  return { words, sentences }
}

const sourceOf = (words: ReadonlyArray<CaptionWord>): ShadowingVideoSource => ({
  metadata: { title: 'Real title', thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg', durationSeconds: 300 },
  captionKind: 'auto',
  words
})

describe('ShadowingImportService.prepareTranscript', () => {
  it('stores 45 aligned sentences in batches 0..2 with contiguous segment indexes, replacing the transcript once [INV-SHADOW-023] [INV-SHADOW-004]', async () => {
    const { words, sentences } = buildCaptions(45)
    const state = makeState()
    const result = await run(state, (s) => s.prepareTranscript(videoId), {
      source: Effect.succeed(sourceOf(words)),
      llm: { segment: () => Effect.succeed(sentences) }
    })

    expect(Either.getOrThrow(result)).toEqual({ outcome: 'ok', sentenceCount: 45 })
    expect(state.fetches).toEqual(['dQw4w9WgXcQ'])
    expect(state.metadata).toEqual([
      { title: 'Real title', thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg', durationSeconds: 300, captionKind: 'auto' }
    ])
    expect(state.segmentCalls).toEqual([{ title: 'Real title', words: words.map((w) => w.text) }])
    expect(state.transcripts).toHaveLength(1)

    const transcript = state.transcripts[0] ?? { sentences: [], segments: [] }
    expect(transcript.sentences.map((s) => s.sentenceIndex)).toEqual(Array.from({ length: 45 }, (_, i) => i))
    expect(transcript.sentences.map((s) => s.batchIndex)).toEqual(
      [...Array.from({ length: 20 }, () => 0), ...Array.from({ length: 20 }, () => 1), ...Array.from({ length: 5 }, () => 2)]
    )
    expect(transcript.sentences[0]).toMatchObject({ startMs: 0, text: sentences[0] })
    expect(transcript.sentences[1]?.startMs).toBe(words[40]?.startMs)

    const { segments } = transcript
    expect(segments.length).toBeGreaterThan(45)
    expect(segments.map((s) => s.segmentIndex)).toEqual(Array.from({ length: segments.length }, (_, i) => i))
    for (const sentence of transcript.sentences) {
      const own = segments.filter((segment) => segment.sentenceIndex === sentence.sentenceIndex)
      expect(own.length).toBeGreaterThanOrEqual(1)
      expect(own.map((segment) => segment.text).join(' ')).toBe(sentence.text)
      expect(own[0]?.startMs).toBe(sentence.startMs)
      expect(own.at(-1)?.endMs).toBe(sentence.endMs)
    }
    expect(segments.filter((segment) => segment.sentenceIndex === 0).length).toBeGreaterThan(1)
  })

  it('returns gone without fetching captions when the video was deleted', async () => {
    const state = makeState({ video: null })
    const result = await run(state, (s) => s.prepareTranscript(videoId))

    expect(Either.getOrThrow(result)).toEqual({ outcome: 'gone' })
    expect(state.fetches).toEqual([])
  })

  it('fails with a retryable import_error when the LLM changes a caption word, storing nothing [INV-SHADOW-004]', async () => {
    const { words, sentences } = buildCaptions(3)
    const altered = [...sentences.slice(0, -1), 'w2x0 changed w2x2.']
    const state = makeState()
    const result = await run(state, (s) => s.prepareTranscript(videoId), {
      source: Effect.succeed(sourceOf(words)),
      llm: { segment: () => Effect.succeed(altered) }
    })

    expect(Either.isLeft(result) && result.left._tag).toBe('SentenceAlignmentError')
    expect(Either.isLeft(result) && classifyShadowingImportError(result.left)).toMatchObject({
      reason: 'import_error',
      retryable: true
    })
    expect(state.transcripts).toEqual([])
  })

  it('classifies missing captions and non-embeddable videos as non-retryable [INV-SHADOW-021]', async () => {
    const noCaptions = await run(makeState(), (s) => s.prepareTranscript(videoId), {
      source: Effect.fail(new NoCaptionsError({ youtubeVideoId: 'dQw4w9WgXcQ' }))
    })
    const notEmbeddable = await run(makeState(), (s) => s.prepareTranscript(videoId), {
      source: Effect.fail(new NotEmbeddableError({ youtubeVideoId: 'dQw4w9WgXcQ' }))
    })
    const sourceFailure = await run(makeState(), (s) => s.prepareTranscript(videoId), {
      source: Effect.fail(new CaptionSourceError({ message: 'yt-dlp exited 1: HTTP 429' }))
    })

    expect(Either.isLeft(noCaptions) && classifyShadowingImportError(noCaptions.left)).toMatchObject({
      reason: 'no_captions',
      retryable: false
    })
    expect(Either.isLeft(notEmbeddable) && classifyShadowingImportError(notEmbeddable.left)).toMatchObject({
      reason: 'not_embeddable',
      retryable: false
    })
    expect(Either.isLeft(sourceFailure) && classifyShadowingImportError(sourceFailure.left)).toEqual({
      reason: 'import_error',
      message: 'yt-dlp exited 1: HTTP 429',
      retryable: true
    })
  })

  it('classifies a missing LLM configuration as non-retryable import_error naming each variable [INV-SHADOW-019]', async () => {
    const { words } = buildCaptions(2)
    const result = await run(makeState(), (s) => s.prepareTranscript(videoId), {
      source: Effect.succeed(sourceOf(words)),
      llm: { segment: () => Effect.fail(new LlmNotConfiguredError({ missing: ['SHADOWING_LLM_API_KEY', 'SHADOWING_LLM_MODEL'] })) }
    })

    const classified = Either.isLeft(result) ? classifyShadowingImportError(result.left) : null
    expect(classified).toMatchObject({ reason: 'import_error', retryable: false })
    expect(classified?.message).toContain('SHADOWING_LLM_API_KEY')
    expect(classified?.message).toContain('SHADOWING_LLM_MODEL')
  })

  it('classifies LLM call failures as retryable import_error', () => {
    expect(classifyShadowingImportError(new LlmCallError({ message: 'segmentation LLM call failed: 503', status: 503 }))).toEqual({
      reason: 'import_error',
      message: 'segmentation LLM call failed: 503',
      retryable: true
    })
  })
})

describe('ShadowingImportService explanations', () => {
  const settledInBatchOne = new Map<number, ShadowingExplanationStatus>([[21, 'ready'], [22, 'regenerating'], [23, 'failed']])
  const fortyFive = (statusOf: (index: number) => ShadowingExplanationStatus = () => 'pending') =>
    Array.from({ length: 45 }, (_, i) => makeSentence(i, statusOf(i)))

  it('explainBatch sends every sentence text with only the pending sentences of that batch as targets [INV-SHADOW-008] [INV-SHADOW-007]', async () => {
    const state = makeState({
      video: makeVideo({ status: 'explaining', sentenceCount: 45 }),
      sentences: fortyFive((i) => settledInBatchOne.get(i) ?? 'pending')
    })
    const result = await run(state, (s) => s.explainBatch(videoId, 1))

    expect(Either.isRight(result)).toBe(true)
    expect(state.explainCalls).toEqual([
      {
        title: 'Imported title',
        sentences: Array.from({ length: 45 }, (_, i) => sentenceText(i)),
        targetIndexes: [20, ...Array.from({ length: 16 }, (_, i) => i + 24)]
      }
    ])
    expect(state.stored).toEqual([{ batchIndex: 1, indexes: [20, ...Array.from({ length: 16 }, (_, i) => i + 24)] }])
  })

  it('explainBatch is a no-op when the batch has nothing pending or the video is gone', async () => {
    const settled = makeState({ video: makeVideo({ status: 'explaining' }), sentences: fortyFive((i) => (i < 20 ? 'ready' : 'pending')) })
    expect(Either.isRight(await run(settled, (s) => s.explainBatch(videoId, 0)))).toBe(true)
    expect(settled.explainCalls).toEqual([])

    const gone = makeState({ video: null, sentences: fortyFive() })
    expect(Either.isRight(await run(gone, (s) => s.explainBatch(videoId, 0)))).toBe(true)
    expect(gone.explainCalls).toEqual([])
  })

  it('explainBatch surfaces LLM failures without storing anything', async () => {
    const state = makeState({ video: makeVideo({ status: 'explaining' }), sentences: fortyFive() })
    const result = await run(state, (s) => s.explainBatch(videoId, 2), {
      llm: { explain: () => Effect.fail(new LlmCallError({ message: 'explanation LLM call failed: timeout' })) }
    })

    expect(Either.isLeft(result) && classifyShadowingImportError(result.left).retryable).toBe(true)
    expect(state.stored).toEqual([])
  })

  it('nextBatch and markBatchFailed delegate to the store', async () => {
    const state = makeState({ nextBatch: Option.some(2) })
    expect(Either.getOrThrow(await run(state, (s) => s.nextBatch(videoId)))).toEqual(Option.some(2))
    expect(Either.getOrThrow(await run(makeState(), (s) => s.nextBatch(videoId)))).toEqual(Option.none())

    await run(state, (s) => s.markBatchFailed(videoId, 2))
    expect(state.failedBatches).toEqual([2])
  })
})

describe('ShadowingImportService status transitions', () => {
  it('markReady moves explaining to ready, never overwrites failed, and is idempotent [INV-SHADOW-011]', async () => {
    const explaining = makeState({ video: makeVideo({ status: 'explaining' }) })
    await run(explaining, (s) => s.markReady(videoId))
    await run(explaining, (s) => s.markReady(videoId))
    expect(explaining.statuses).toEqual([{ status: 'ready', failure: undefined }])

    const failed = makeState({ video: makeVideo({ status: 'failed', failureReason: 'no_captions' }) })
    expect(Either.isRight(await run(failed, (s) => s.markReady(videoId)))).toBe(true)
    expect(failed.statuses).toEqual([])

    const gone = makeState({ video: null })
    expect(Either.isRight(await run(gone, (s) => s.markReady(videoId)))).toBe(true)
  })

  it('failImport stores the reason and message; a deleted video is a no-op [INV-SHADOW-021]', async () => {
    const state = makeState()
    await run(state, (s) => s.failImport(videoId, 'no_captions', 'Video has no English captions'))
    expect(state.statuses).toEqual([
      { status: 'failed', failure: { reason: 'no_captions', message: 'Video has no English captions' } }
    ])

    const gone = makeState({ video: null })
    expect(Either.isRight(await run(gone, (s) => s.failImport(videoId, 'import_error', 'boom')))).toBe(true)
    expect(gone.statuses).toEqual([])
  })
})

describe('ShadowingImportService regeneration', () => {
  it('explains only the regenerating sentence with the full transcript and stores it [INV-SHADOW-012]', async () => {
    const sentences = [makeSentence(0, 'ready'), makeSentence(1, 'regenerating'), makeSentence(2, 'pending')]
    const state = makeState({ video: makeVideo({ status: 'ready' }), sentences })
    const result = await run(state, (s) => s.regenerate('sentence-1'))

    expect(Either.isRight(result)).toBe(true)
    expect(state.explainCalls).toEqual([
      { title: 'Imported title', sentences: [sentenceText(0), sentenceText(1), sentenceText(2)], targetIndexes: [1] }
    ])
    expect(state.finished).toEqual([{ sentenceId: 'sentence-1', result: Either.right(explanationFor(1)) }])
  })

  it('does nothing unless the sentence is regenerating, or when it is gone [INV-SHADOW-012]', async () => {
    const state = makeState({ video: makeVideo({ status: 'ready' }), sentences: [makeSentence(0, 'ready')] })
    expect(Either.isRight(await run(state, (s) => s.regenerate('sentence-0')))).toBe(true)
    expect(Either.isRight(await run(state, (s) => s.regenerate('missing')))).toBe(true)
    expect(state.explainCalls).toEqual([])
    expect(state.finished).toEqual([])
  })

  it('failRegeneration records a Left with the message [INV-SHADOW-012]', async () => {
    const state = makeState()
    await run(state, (s) => s.failRegeneration('sentence-1', 'explanation LLM call failed: 500'))
    expect(state.finished).toEqual([{ sentenceId: 'sentence-1', result: Either.left('explanation LLM call failed: 500') }])
  })
})
