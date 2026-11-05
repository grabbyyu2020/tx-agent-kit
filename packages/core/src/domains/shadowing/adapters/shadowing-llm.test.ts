import {
  ChatCompletionError,
  ShadowingLlmNotConfiguredError,
  type ChatCompletionRequest,
  type ChatCompletionResult
} from '@tx-agent-kit/ai'
import { SHADOWING_SEGMENTATION_CHUNK_WORDS } from '@tx-agent-kit/contracts'
import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { buildExplanationMessages, buildSegmentationMessages } from '../domain/prompts.js'
import type { ShadowingLlmPort } from '../ports/shadowing-ports.js'
import { makeShadowingLlm } from './shadowing-llm.js'

type Reply = (request: ChatCompletionRequest) => Effect.Effect<unknown, ChatCompletionError | ShadowingLlmNotConfiguredError>

/** Fake chatCompletionsJson: records requests and answers with `reply`. */
const fakeChat = (reply: Reply) => {
  const requests: ChatCompletionRequest[] = []
  const chatCompletionsJson = (request: ChatCompletionRequest, ...rest: ReadonlyArray<unknown>) => {
    requests.push(request)
    expect(rest).toEqual([])
    return reply(request).pipe(
      Effect.map((json): ChatCompletionResult => ({
        json,
        model: 'configured-model',
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null }
      }))
    )
  }
  const llm: ShadowingLlmPort['Type'] = makeShadowingLlm({ chatCompletionsJson })
  return { requests, llm }
}

const captionWordsOf = (request: ChatCompletionRequest | undefined): ReadonlyArray<string> =>
  (request?.messages.at(-1)?.content.split('Caption words:\n')[1] ?? '').split(' ')

const sentence = (words: ReadonlyArray<string>): string => `${words.join(' ')}.`

const expectLlmCallError = (result: Either.Either<unknown, unknown>, messagePart: string): void => {
  const error = Either.isLeft(result) ? result.left : null
  expect(error).toMatchObject({ _tag: 'LlmCallError' })
  expect(error).toHaveProperty('message', expect.stringContaining(messagePart))
}

const explanation = (sentenceIndex: number) => ({
  sentenceIndex,
  meaning: '意思',
  keyExpressions: [],
  toneAndContext: '随意'
})

describe('ShadowingLlmPort adapter', () => {
  it('segments in chunks and carries the trailing sentence of a chunk into the next one', async () => {
    const words = Array.from({ length: SHADOWING_SEGMENTATION_CHUNK_WORDS + 500 }, (_, i) => `w${i}`)
    // Each reply: every 10 words form a sentence; the last group of a chunk may be incomplete.
    const { requests, llm } = fakeChat((request) => {
      const chunk = captionWordsOf(request)
      const groups = Array.from({ length: Math.ceil(chunk.length / 10) }, (_, g) => chunk.slice(g * 10, g * 10 + 10))
      if (chunk[0] === 'w0') {
        // First chunk: its final 10 words come back as two sentences; the 5-word tail is carried over.
        const last = groups.pop() ?? []
        groups.push(last.slice(0, 5), last.slice(5))
      }
      return Effect.succeed({ sentences: groups.map(sentence) })
    })

    const result = await Effect.runPromise(llm.segmentSentences({ title: 'Talk', words }))

    expect(requests).toHaveLength(2)
    expect(requests[0]?.messages).toEqual(
      buildSegmentationMessages({ title: 'Talk', words: words.slice(0, SHADOWING_SEGMENTATION_CHUNK_WORDS).map((text) => ({ text })) })
    )
    expect(captionWordsOf(requests[1])).toEqual(words.slice(SHADOWING_SEGMENTATION_CHUNK_WORDS - 5))
    expect(requests.every((r) => r.stepName === 'segmentation')).toBe(true)
    expect(result.join(' ').replaceAll('.', '').split(' ')).toEqual(words)
  })

  it('returns no sentences for an empty transcript without calling the LLM', async () => {
    const { requests, llm } = fakeChat(() => Effect.succeed({ sentences: [] }))

    expect(await Effect.runPromise(llm.segmentSentences({ title: 'Talk', words: [] }))).toEqual([])
    expect(requests).toEqual([])
  })

  it.each([
    { sentences: [] },
    { sentences: ['ok.', ''] },
    { sentences: 'one. two.' },
    { other: ['a'] },
    ['a']
  ])('maps malformed segmentation output %j to LlmCallError', async (json) => {
    const { llm } = fakeChat(() => Effect.succeed(json))

    const result = await Effect.runPromise(Effect.either(llm.segmentSentences({ title: 'Talk', words: ['a', 'b'] })))

    expectLlmCallError(result, 'segmentation')
  })

  it('maps ChatCompletionError to LlmCallError keeping message and status', async () => {
    const { llm } = fakeChat(() =>
      Effect.fail(new ChatCompletionError({ message: 'HTTP 503 from LLM endpoint', reason: 'http_status', retryable: true, status: 503 }))
    )

    const result = await Effect.runPromise(Effect.either(llm.segmentSentences({ title: 'Talk', words: ['a'] })))

    expectLlmCallError(result, 'HTTP 503 from LLM endpoint')
    expect(Either.isLeft(result) && result.left).toHaveProperty('status', 503)
  })

  it('explains a batch with the explanation prompt and returns decoded explanations', async () => {
    const sentences = ['Hello there.', 'Break a leg.', 'Bye.']
    const { requests, llm } = fakeChat(() => Effect.succeed({ explanations: [explanation(1), explanation(2)] }))

    const result = await Effect.runPromise(llm.explainSentences({ title: 'Talk', sentences, targetIndexes: [1, 2] }))

    expect([...result.keys()]).toEqual([1, 2])
    expect(requests[0]?.stepName).toBe('explanation')
    expect(requests[0]?.messages).toEqual(buildExplanationMessages({ title: 'Talk', sentences, targetIndexes: [1, 2] }))
  })

  it('maps an explanation decode error to LlmCallError', async () => {
    const { llm } = fakeChat(() => Effect.succeed({ explanations: [explanation(1)] }))

    const result = await Effect.runPromise(
      Effect.either(llm.explainSentences({ title: 'Talk', sentences: ['a.', 'b.', 'c.'], targetIndexes: [1, 2] }))
    )

    expectLlmCallError(result, 'explanation')
  })

  it('maps a missing LLM configuration to LlmNotConfiguredError naming the variables [INV-SHADOW-019]', async () => {
    const missing = ['SHADOWING_LLM_API_KEY', 'SHADOWING_LLM_MODEL']
    const { llm } = fakeChat(() => Effect.fail(new ShadowingLlmNotConfiguredError({ message: 'not configured', missing })))

    const segment = await Effect.runPromise(Effect.either(llm.segmentSentences({ title: 'Talk', words: ['a'] })))
    const explain = await Effect.runPromise(
      Effect.either(llm.explainSentences({ title: 'Talk', sentences: ['a.'], targetIndexes: [0] }))
    )

    for (const result of [segment, explain]) {
      expect(result).toEqual(Either.left(expect.objectContaining({ _tag: 'LlmNotConfiguredError', missing })))
    }
  })

  it('uses the client-configured model for both steps (no model override in requests) [INV-SHADOW-019]', async () => {
    const { requests, llm } = fakeChat((request) =>
      Effect.succeed(request.stepName === 'segmentation' ? { sentences: ['a b.'] } : { explanations: [explanation(0)] })
    )

    await Effect.runPromise(llm.segmentSentences({ title: 'Talk', words: ['a', 'b'] }))
    await Effect.runPromise(llm.explainSentences({ title: 'Talk', sentences: ['a b.'], targetIndexes: [0] }))

    expect(requests.map((r) => r.stepName)).toEqual(['segmentation', 'explanation'])
    for (const request of requests) {
      expect(request).not.toHaveProperty('model')
    }
  })
})
