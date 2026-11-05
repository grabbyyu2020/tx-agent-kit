import { Either } from 'effect'
import * as Schema from 'effect/Schema'

export interface AiEnv {
  OPENROUTER_API_KEY: string
  OPENROUTER_BASE_URL: string
  OPENROUTER_MODEL: string
  OPENROUTER_EMBEDDING_MODEL: string
}

const defaultChatModel = 'openai/gpt-4.1-mini'
const defaultEmbeddingModel = 'openai/text-embedding-3-small'

const shadowingLlmEnvKeys = [
  'SHADOWING_LLM_API_KEY',
  'SHADOWING_LLM_BASE_URL',
  'SHADOWING_LLM_MODEL'
] as const

type ShadowingLlmEnvKey = (typeof shadowingLlmEnvKeys)[number]

export type AiEnvKey = keyof AiEnv | ShadowingLlmEnvKey

const aiEnvOverrides: Partial<Record<AiEnvKey, string | null>> = {}

const readAiEnvValue = (key: AiEnvKey, fallback: string): string => {
  if (Object.prototype.hasOwnProperty.call(aiEnvOverrides, key)) {
    return aiEnvOverrides[key] ?? fallback
  }
  return process.env[key] ?? fallback
}

export const setAiEnvOverride = (
  key: AiEnvKey,
  value: string | undefined
): void => {
  aiEnvOverrides[key] = value ?? null
}

export const clearAiEnvOverrides = (): void => {
  delete aiEnvOverrides.OPENROUTER_API_KEY
  delete aiEnvOverrides.OPENROUTER_BASE_URL
  delete aiEnvOverrides.OPENROUTER_MODEL
  delete aiEnvOverrides.OPENROUTER_EMBEDDING_MODEL
  delete aiEnvOverrides.SHADOWING_LLM_API_KEY
  delete aiEnvOverrides.SHADOWING_LLM_BASE_URL
  delete aiEnvOverrides.SHADOWING_LLM_MODEL
}

export const getAiEnv = (): AiEnv => {
  return {
    OPENROUTER_API_KEY: readAiEnvValue('OPENROUTER_API_KEY', ''),
    OPENROUTER_BASE_URL: readAiEnvValue('OPENROUTER_BASE_URL', ''),
    OPENROUTER_MODEL: readAiEnvValue('OPENROUTER_MODEL', defaultChatModel),
    OPENROUTER_EMBEDDING_MODEL: readAiEnvValue(
      'OPENROUTER_EMBEDDING_MODEL',
      defaultEmbeddingModel
    )
  }
}

export interface ShadowingLlmEnv {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

/**
 * Raised when any SHADOWING_LLM_* variable is missing. The message names the
 * missing variables only; values are never included.
 */
export class ShadowingLlmNotConfiguredError extends Schema.TaggedError<ShadowingLlmNotConfiguredError>()(
  'ShadowingLlmNotConfiguredError',
  {
    message: Schema.String,
    missing: Schema.Array(Schema.String)
  }
) {}

export const getShadowingLlmEnv = (): Either.Either<
  ShadowingLlmEnv,
  ShadowingLlmNotConfiguredError
> => {
  const values = {
    SHADOWING_LLM_API_KEY: readAiEnvValue('SHADOWING_LLM_API_KEY', '').trim(),
    SHADOWING_LLM_BASE_URL: readAiEnvValue('SHADOWING_LLM_BASE_URL', '').trim(),
    SHADOWING_LLM_MODEL: readAiEnvValue('SHADOWING_LLM_MODEL', '').trim()
  }
  const missing = shadowingLlmEnvKeys.filter((key) => values[key].length === 0)

  if (missing.length > 0) {
    return Either.left(
      new ShadowingLlmNotConfiguredError({
        message: `Shadowing LLM is not configured; missing environment variables: ${missing.join(', ')}`,
        missing
      })
    )
  }

  return Either.right({
    apiKey: values.SHADOWING_LLM_API_KEY,
    baseUrl: values.SHADOWING_LLM_BASE_URL,
    model: values.SHADOWING_LLM_MODEL
  })
}
