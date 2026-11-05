import { Effect, Either, Exit } from 'effect'
import * as Schema from 'effect/Schema'
import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import {
  getShadowingLlmEnv,
  type ShadowingLlmEnv,
  type ShadowingLlmNotConfiguredError
} from './env.js'

const TRACER_NAME = 'tx-agent-kit.ai'
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_ERROR_BODY_CHARS = 500

export interface ChatCompletionMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

export interface ChatCompletionRequest {
  readonly messages: ReadonlyArray<ChatCompletionMessage>
  readonly stepName: string
  readonly temperature?: number
  readonly maxTokens?: number
}

export interface ChatCompletionOptions {
  readonly fetch?: typeof fetch
  readonly env?: ShadowingLlmEnv
  readonly timeoutMs?: number
}

export interface ChatCompletionUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number | null
}

export interface ChatCompletionResult {
  readonly json: unknown
  readonly model: string
  readonly usage: ChatCompletionUsage
}

export const ChatCompletionErrorReason = Schema.Literal(
  'http_status',
  'network',
  'timeout',
  'empty_content',
  'invalid_json'
)
export type ChatCompletionErrorReason = typeof ChatCompletionErrorReason.Type

export class ChatCompletionError extends Schema.TaggedError<ChatCompletionError>()(
  'ChatCompletionError',
  {
    message: Schema.String,
    reason: ChatCompletionErrorReason,
    retryable: Schema.Boolean,
    status: Schema.optional(Schema.Number)
  }
) {}

const redact = (text: string, secret: string): string =>
  secret.length > 0 ? text.split(secret).join('[REDACTED]') : text

const truncate = (text: string): string =>
  text.length > MAX_ERROR_BODY_CHARS
    ? `${text.slice(0, MAX_ERROR_BODY_CHARS)}…`
    : text

const chatCompletionsUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/chat/completions`

const stripJsonFence = (content: string): string => {
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(content)
  return fenced?.[1]?.trim() ?? content
}

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'TimeoutError' || error.name === 'AbortError')

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const mapUsage = (body: Record<string, unknown>): ChatCompletionUsage => {
  const usage = asRecord(body.usage)
  const details = asRecord(usage?.prompt_tokens_details)
  return {
    inputTokens: asNumber(usage?.prompt_tokens) ?? 0,
    outputTokens: asNumber(usage?.completion_tokens) ?? 0,
    cachedTokens: asNumber(details?.cached_tokens)
  }
}

const extractContent = (body: Record<string, unknown>): string | undefined => {
  const choices = body.choices
  if (!Array.isArray(choices)) {
    return undefined
  }
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.content
  return typeof content === 'string' ? content : undefined
}

const callEndpoint = (
  request: ChatCompletionRequest,
  env: ShadowingLlmEnv,
  fetchFn: typeof fetch,
  timeoutMs: number
): Effect.Effect<ChatCompletionResult, ChatCompletionError> =>
  Effect.gen(function* () {
    const body: Record<string, unknown> = {
      model: env.model,
      messages: request.messages,
      response_format: { type: 'json_object' }
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchFn(chatCompletionsUrl(env.baseUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        }),
      catch: (error) =>
        isTimeoutError(error)
          ? new ChatCompletionError({
              reason: 'timeout',
              retryable: true,
              message: `LLM request timed out after ${timeoutMs}ms`
            })
          : new ChatCompletionError({
              reason: 'network',
              retryable: true,
              message: redact(
                `LLM request failed: ${error instanceof Error ? error.message : String(error)}`,
                env.apiKey
              )
            })
    })

    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) =>
        isTimeoutError(error)
          ? new ChatCompletionError({
              reason: 'timeout',
              retryable: true,
              message: `LLM response timed out after ${timeoutMs}ms`
            })
          : new ChatCompletionError({
              reason: 'network',
              retryable: true,
              message: 'LLM response body could not be read'
            })
    })

    if (!response.ok) {
      const status = response.status
      return yield* new ChatCompletionError({
        reason: 'http_status',
        status,
        retryable: status === 429 || status >= 500,
        message: redact(
          `LLM endpoint returned HTTP ${status}: ${truncate(text)}`,
          env.apiKey
        )
      })
    }

    const parsedBody = Either.try(() => JSON.parse(text) as unknown)
    const record = Either.isRight(parsedBody)
      ? asRecord(parsedBody.right)
      : undefined
    if (record === undefined) {
      return yield* new ChatCompletionError({
        reason: 'invalid_json',
        retryable: false,
        message: 'LLM endpoint returned a non-JSON response body'
      })
    }

    const content = extractContent(record)?.trim()
    if (content === undefined || content.length === 0) {
      return yield* new ChatCompletionError({
        reason: 'empty_content',
        retryable: false,
        message: 'LLM response had no message content'
      })
    }

    const json = Either.try(() => JSON.parse(stripJsonFence(content)) as unknown)
    if (Either.isLeft(json)) {
      return yield* new ChatCompletionError({
        reason: 'invalid_json',
        retryable: false,
        message: `LLM message content is not valid JSON (${content.length} chars)`
      })
    }

    return {
      json: json.right,
      model: typeof record.model === 'string' ? record.model : env.model,
      usage: mapUsage(record)
    }
  })

/**
 * POSTs an OpenAI-compatible JSON-mode chat completion to
 * `${SHADOWING_LLM_BASE_URL}/chat/completions` inside a
 * `shadowing.llm.<stepName>` span. Neither the API key nor message
 * contents are recorded on the span or in error messages.
 */
export const chatCompletionsJson = (
  request: ChatCompletionRequest,
  options?: ChatCompletionOptions
): Effect.Effect<
  ChatCompletionResult,
  ChatCompletionError | ShadowingLlmNotConfiguredError
> =>
  Effect.gen(function* () {
    const env = options?.env ?? (yield* getShadowingLlmEnv())
    const fetchFn = options?.fetch ?? globalThis.fetch
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        trace.getTracer(TRACER_NAME).startSpan(
          `shadowing.llm.${request.stepName}`,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              'gen_ai.system': 'openai-compatible',
              'gen_ai.operation.name': 'chat',
              'gen_ai.request.model': env.model
            }
          },
          context.active()
        )
      ),
      (span) =>
        callEndpoint(request, env, fetchFn, timeoutMs).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              span.setAttribute('gen_ai.response.model', result.model)
              span.setAttribute('gen_ai.usage.input_tokens', result.usage.inputTokens)
              span.setAttribute('gen_ai.usage.output_tokens', result.usage.outputTokens)
              if (result.usage.cachedTokens !== null) {
                span.setAttribute('gen_ai.usage.cached_tokens', result.usage.cachedTokens)
              }
            })
          ),
          Effect.tapError((error) =>
            Effect.sync(() => {
              span.setAttribute('error.type', error.reason)
              span.recordException({ name: error._tag, message: error.message })
            })
          )
        ),
      (span, exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'LLM call failed' })
          } else {
            span.setStatus({ code: SpanStatusCode.OK })
          }
          span.end()
        })
    )
  })
