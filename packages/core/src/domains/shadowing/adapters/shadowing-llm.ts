import type {
  ChatCompletionError,
  ChatCompletionRequest,
  ChatCompletionResult,
  ShadowingLlmNotConfiguredError
} from '@tx-agent-kit/ai'
import { SHADOWING_SEGMENTATION_CHUNK_WORDS } from '@tx-agent-kit/contracts'
import { Effect, Either, Layer } from 'effect'
import { decodeExplanationBatch } from '../domain/explanation.js'
import { buildExplanationMessages, buildSegmentationMessages } from '../domain/prompts.js'
import { LlmCallError, LlmNotConfiguredError } from '../domain/shadowing-errors.js'
import { ShadowingLlmPort } from '../ports/shadowing-ports.js'

type ChatCompletionsJsonFn = (
  request: ChatCompletionRequest
) => Effect.Effect<ChatCompletionResult, ChatCompletionError | ShadowingLlmNotConfiguredError | LlmCallError>

type ShadowingLlmDepsOptions = {
  /** Defaults to `chatCompletionsJson` from `@tx-agent-kit/ai` (env-configured endpoint and model). */
  readonly chatCompletionsJson?: ChatCompletionsJsonFn
}

type LlmStepName = 'segmentation' | 'explanation'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const tokenCount = (sentence: string): number => sentence.split(/\s+/).filter((token) => token.length > 0).length

const decodeSentences = (json: unknown): Either.Either<ReadonlyArray<string>, string> => {
  const sentences = isRecord(json) ? json.sentences : undefined
  if (!Array.isArray(sentences) || sentences.length === 0) {
    return Either.left('expected {"sentences": [...]} with at least one sentence')
  }
  const texts = sentences.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  return texts.length === sentences.length ? Either.right(texts) : Either.left('every sentence must be a non-empty string')
}

/**
 * {@link ShadowingLlmPort} over the OpenAI-compatible JSON chat client. Both steps rely on the
 * client's configured `SHADOWING_LLM_MODEL`; requests never override the model.
 */
export const makeShadowingLlm = (deps?: ShadowingLlmDepsOptions): ShadowingLlmPort['Type'] => {
  // @tx-agent-kit/ai is loaded on first call so importing @tx-agent-kit/core stays cheap.
  const chat =
    deps?.chatCompletionsJson ??
    ((request: ChatCompletionRequest) =>
      Effect.flatMap(
        Effect.tryPromise({
          try: () => import('@tx-agent-kit/ai'),
          catch: (cause) => new LlmCallError({ message: `Failed to load the LLM client: ${String(cause)}` })
        }),
        (ai) => ai.chatCompletionsJson(request)
      ))

  const callJson = (stepName: LlmStepName, messages: ChatCompletionRequest['messages']) =>
    chat({ stepName, messages }).pipe(
      Effect.map((result) => result.json),
      Effect.catchTags({
        ChatCompletionError: (error) =>
          Effect.fail(
            new LlmCallError({
              message: `${stepName} LLM call failed: ${error.message}`,
              ...(error.status === undefined ? {} : { status: error.status })
            })
          ),
        ShadowingLlmNotConfiguredError: (error) => Effect.fail(new LlmNotConfiguredError({ missing: error.missing }))
      })
    )

  const segmentChunk = (title: string, words: ReadonlyArray<string>) =>
    Effect.flatMap(callJson('segmentation', buildSegmentationMessages({ title, words: words.map((text) => ({ text })) })), (json) =>
      Either.match(decodeSentences(json), {
        onLeft: (reason) => Effect.fail(new LlmCallError({ message: `Malformed segmentation output: ${reason}` })),
        onRight: (sentences) => Effect.succeed(sentences)
      })
    )

  return {
    /**
     * Chunks of SHADOWING_SEGMENTATION_CHUNK_WORDS words. The last sentence of a non-final chunk may
     * be cut off, so its words are re-sent at the start of the next chunk instead of being kept.
     */
    segmentSentences: ({ title, words }) =>
      Effect.gen(function* () {
        const result: string[] = []
        let start = 0
        while (start < words.length) {
          const end = Math.min(start + SHADOWING_SEGMENTATION_CHUNK_WORDS, words.length)
          const sentences = yield* segmentChunk(title, words.slice(start, end))
          const last = sentences.at(-1)
          const carried = last === undefined ? 0 : tokenCount(last)
          const next = end - carried
          if (end === words.length || sentences.length < 2 || next <= start) {
            result.push(...sentences)
            start = end
          } else {
            result.push(...sentences.slice(0, -1))
            start = next
          }
        }
        return result
      }),

    explainSentences: ({ title, sentences, targetIndexes }) =>
      Effect.flatMap(callJson('explanation', buildExplanationMessages({ title, sentences, targetIndexes })), (json) =>
        Either.match(
          decodeExplanationBatch(
            json,
            targetIndexes.map((sentenceIndex) => ({ sentenceIndex, text: sentences[sentenceIndex] ?? '' }))
          ),
          {
            onLeft: (error) =>
              Effect.fail(new LlmCallError({ message: `Malformed explanation output (${error.reason}): ${error.message}` })),
            onRight: (explanations) => Effect.succeed(explanations)
          }
        )
      )
  }
}

/** Live {@link ShadowingLlmPort} using the env-configured OpenAI-compatible endpoint. */
export const ShadowingLlmPortLive = Layer.succeed(ShadowingLlmPort, makeShadowingLlm())
