import { Effect, Either } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const setAttribute = vi.fn()
  const setStatus = vi.fn()
  const recordException = vi.fn()
  const end = vi.fn()
  const span = { setAttribute, setStatus, recordException, end }
  const startSpan = vi.fn(
    (
      _name: string,
      _options: { kind: string; attributes: Record<string, unknown> },
      _context: unknown
    ) => span
  )
  return { setAttribute, setStatus, recordException, end, span, startSpan }
})

vi.mock('@opentelemetry/api', () => ({
  context: { active: vi.fn(() => ({ active: true })) },
  trace: { getTracer: vi.fn(() => ({ startSpan: mocks.startSpan })) },
  SpanKind: { CLIENT: 'CLIENT' },
  SpanStatusCode: { ERROR: 'ERROR', OK: 'OK' }
}))

import {
  clearAiEnvOverrides,
  setAiEnvOverride,
  type ShadowingLlmEnv
} from './env.js'
import {
  chatCompletionsJson,
  type ChatCompletionError,
  type ChatCompletionRequest
} from './openai-compatible.js'

const SECRET_KEY = 'sk-test-secret-do-not-leak-123'

const env: ShadowingLlmEnv = {
  apiKey: SECRET_KEY,
  baseUrl: 'https://llm.example.test/v1',
  model: 'gpt-test-mini'
}

const request: ChatCompletionRequest = {
  stepName: 'segment',
  messages: [
    { role: 'system', content: 'You segment transcripts.' },
    { role: 'user', content: 'secret user content' }
  ],
  temperature: 0.2
}

interface RecordedCall {
  readonly url: string
  readonly init: RequestInit
}

const okBody = (content: string | null, usage?: Record<string, unknown>) => ({
  model: 'gpt-test-mini-2025',
  choices: [{ message: { role: 'assistant', content } }],
  usage: usage ?? { prompt_tokens: 11, completion_tokens: 7 }
})

const fakeFetch = (
  respond: () => Response | Promise<Response>
): { fetch: typeof fetch; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = []
  const fn = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof input !== 'string') {
      throw new Error('expected a string URL')
    }
    calls.push({ url: input, init: init ?? {} })
    return Promise.resolve(respond())
  }
  return { fetch: fn as typeof fetch, calls }
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const runFailure = async (
  effect: ReturnType<typeof chatCompletionsJson>
) => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (Either.isRight(result)) {
    throw new Error('expected failure')
  }
  return result.left
}

beforeEach(() => {
  mocks.startSpan.mockClear()
  mocks.setAttribute.mockClear()
  mocks.setStatus.mockClear()
  mocks.recordException.mockClear()
  mocks.end.mockClear()
})

afterEach(() => {
  clearAiEnvOverrides()
})

describe('chatCompletionsJson', () => {
  it('[INV-SHADOW-019] posts to base URL chat completions with bearer key', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(okBody('{"ok":true}')))

    await Effect.runPromise(chatCompletionsJson(request, { fetch, env }))

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe('https://llm.example.test/v1/chat/completions')
    expect(call.init.method).toBe('POST')
    const headers = new Headers(call.init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET_KEY}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(call.init.signal).toBeInstanceOf(AbortSignal)

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>
    expect(body.model).toBe('gpt-test-mini')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual(request.messages)
    expect(body.temperature).toBe(0.2)
  })

  it('[INV-SHADOW-019] joins a base URL with trailing slashes without doubling them', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(okBody('{}')))

    await Effect.runPromise(
      chatCompletionsJson(request, {
        fetch,
        env: { ...env, baseUrl: 'https://llm.example.test/v1/' }
      })
    )

    expect(calls[0]!.url).toBe('https://llm.example.test/v1/chat/completions')
  })

  it('[INV-SHADOW-019] reads base URL, model and key from SHADOWING_LLM_* env overrides', async () => {
    setAiEnvOverride('SHADOWING_LLM_API_KEY', SECRET_KEY)
    setAiEnvOverride('SHADOWING_LLM_BASE_URL', 'https://env.example.test/api/')
    setAiEnvOverride('SHADOWING_LLM_MODEL', 'env-model')
    const { fetch, calls } = fakeFetch(() => jsonResponse(okBody('{}')))

    await Effect.runPromise(chatCompletionsJson(request, { fetch }))

    expect(calls[0]!.url).toBe('https://env.example.test/api/chat/completions')
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>
    expect(body.model).toBe('env-model')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(
      `Bearer ${SECRET_KEY}`
    )
  })

  it('[INV-SHADOW-019] parses JSON content and maps usage without cached tokens', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(okBody('{"sentences":[{"text":"hi"}]}'))
    )

    const result = await Effect.runPromise(
      chatCompletionsJson(request, { fetch, env })
    )

    expect(result.json).toEqual({ sentences: [{ text: 'hi' }] })
    expect(result.model).toBe('gpt-test-mini-2025')
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cachedTokens: null
    })
  })

  it('[INV-SHADOW-019] parses fenced JSON content and maps cached tokens', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(
        okBody('```json\n{"a":1}\n```', {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 64 }
        })
      )
    )

    const result = await Effect.runPromise(
      chatCompletionsJson(request, { fetch, env })
    )

    expect(result.json).toEqual({ a: 1 })
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 64
    })
  })

  it('[INV-SHADOW-019] classifies 429 and 500 as retryable and 400 as not retryable', async () => {
    const statusFailure = async (status: number) =>
      runFailure(
        chatCompletionsJson(request, {
          fetch: fakeFetch(() =>
            new Response(`upstream said no ${'x'.repeat(2000)}`, { status })
          ).fetch,
          env
        })
      )

    const tooMany = (await statusFailure(429)) as ChatCompletionError
    const server = (await statusFailure(500)) as ChatCompletionError
    const bad = (await statusFailure(400)) as ChatCompletionError

    expect(tooMany._tag).toBe('ChatCompletionError')
    expect(tooMany.reason).toBe('http_status')
    expect(tooMany.status).toBe(429)
    expect(tooMany.retryable).toBe(true)
    expect(server.retryable).toBe(true)
    expect(server.status).toBe(500)
    expect(bad.retryable).toBe(false)
    expect(bad.status).toBe(400)
    expect(bad.message).toContain('400')
    expect(bad.message).toContain('upstream said no')
    expect(bad.message.length).toBeLessThan(1000)
  })

  it('[INV-SHADOW-019] classifies network errors and timeouts as retryable', async () => {
    const network = (await runFailure(
      chatCompletionsJson(request, {
        fetch: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
        env
      })
    )) as ChatCompletionError
    const timeout = (await runFailure(
      chatCompletionsJson(request, {
        fetch: (() =>
          Promise.reject(
            new DOMException('The operation timed out.', 'TimeoutError')
          )) as typeof fetch,
        env
      })
    )) as ChatCompletionError

    expect(network.reason).toBe('network')
    expect(network.retryable).toBe(true)
    expect(timeout.reason).toBe('timeout')
    expect(timeout.retryable).toBe(true)
  })

  it('[INV-SHADOW-019] fails with invalid_json and empty_content as non-retryable errors', async () => {
    const invalid = (await runFailure(
      chatCompletionsJson(request, {
        fetch: fakeFetch(() => jsonResponse(okBody('not json {'))).fetch,
        env
      })
    )) as ChatCompletionError
    const empty = (await runFailure(
      chatCompletionsJson(request, {
        fetch: fakeFetch(() => jsonResponse(okBody(''))).fetch,
        env
      })
    )) as ChatCompletionError

    expect(invalid.reason).toBe('invalid_json')
    expect(invalid.retryable).toBe(false)
    expect(empty.reason).toBe('empty_content')
    expect(empty.retryable).toBe(false)
  })

  it('[INV-SHADOW-019] fails with a message listing every missing SHADOWING_LLM_* variable', async () => {
    setAiEnvOverride('SHADOWING_LLM_API_KEY', undefined)
    setAiEnvOverride('SHADOWING_LLM_BASE_URL', undefined)
    setAiEnvOverride('SHADOWING_LLM_MODEL', undefined)
    const { fetch, calls } = fakeFetch(() => jsonResponse(okBody('{}')))

    const error = await runFailure(chatCompletionsJson(request, { fetch }))

    expect(error._tag).toBe('ShadowingLlmNotConfiguredError')
    expect(error.message).toContain('SHADOWING_LLM_API_KEY')
    expect(error.message).toContain('SHADOWING_LLM_BASE_URL')
    expect(error.message).toContain('SHADOWING_LLM_MODEL')
    expect(calls).toHaveLength(0)
  })

  it('[INV-SHADOW-019] never includes the API key in any error message', async () => {
    const echoKey = `bad key ${SECRET_KEY} rejected`
    const failures = await Promise.all([
      runFailure(
        chatCompletionsJson(request, {
          fetch: fakeFetch(() => new Response(echoKey, { status: 401 })).fetch,
          env
        })
      ),
      runFailure(
        chatCompletionsJson(request, {
          fetch: (() => Promise.reject(new TypeError(echoKey))) as typeof fetch,
          env
        })
      ),
      runFailure(
        chatCompletionsJson(request, {
          fetch: fakeFetch(() => jsonResponse(okBody(echoKey))).fetch,
          env
        })
      ),
      runFailure(
        chatCompletionsJson(request, {
          fetch: fakeFetch(() => jsonResponse(okBody(null))).fetch,
          env
        })
      )
    ])

    setAiEnvOverride('SHADOWING_LLM_API_KEY', SECRET_KEY)
    setAiEnvOverride('SHADOWING_LLM_BASE_URL', undefined)
    setAiEnvOverride('SHADOWING_LLM_MODEL', undefined)
    failures.push(await runFailure(chatCompletionsJson(request, {})))

    for (const failure of failures) {
      expect(failure.message).not.toContain(SECRET_KEY)
      expect(JSON.stringify(failure)).not.toContain(SECRET_KEY)
    }
  })

  it('[INV-SHADOW-019] opens a shadowing.llm.<step> span with usage attributes and no secrets', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(
        okBody('{}', {
          prompt_tokens: 5,
          completion_tokens: 3,
          prompt_tokens_details: { cached_tokens: 2 }
        })
      )
    )

    await Effect.runPromise(chatCompletionsJson(request, { fetch, env }))

    expect(mocks.startSpan).toHaveBeenCalledTimes(1)
    const [name, options] = mocks.startSpan.mock.calls[0]!
    expect(name).toBe('shadowing.llm.segment')
    expect(options.attributes).toMatchObject({
      'gen_ai.system': 'openai-compatible',
      'gen_ai.request.model': 'gpt-test-mini'
    })
    const attributes: Record<string, unknown> = {}
    for (const [key, value] of mocks.setAttribute.mock.calls as Array<[string, unknown]>) {
      attributes[key] = value
    }
    expect(attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 5,
      'gen_ai.usage.output_tokens': 3,
      'gen_ai.usage.cached_tokens': 2
    })
    const serialized = JSON.stringify([options, mocks.setAttribute.mock.calls])
    expect(serialized).not.toContain(SECRET_KEY)
    expect(serialized).not.toContain('secret user content')
    expect(mocks.setStatus).toHaveBeenCalledWith({ code: 'OK' })
    expect(mocks.end).toHaveBeenCalledTimes(1)
  })

  it('[INV-SHADOW-019] records an error status on the span when the call fails', async () => {
    const { fetch } = fakeFetch(() => new Response('boom', { status: 503 }))

    await runFailure(chatCompletionsJson(request, { fetch, env }))

    expect(mocks.recordException).toHaveBeenCalledTimes(1)
    expect(mocks.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ERROR' })
    )
    expect(mocks.end).toHaveBeenCalledTimes(1)
  })
})
