import { afterEach, describe, expect, it } from 'vitest'
import { Either } from 'effect'
import {
  clearAiEnvOverrides,
  getAiEnv,
  getShadowingLlmEnv,
  setAiEnvOverride
} from './env.js'

const originalEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENROUTER_EMBEDDING_MODEL: process.env.OPENROUTER_EMBEDDING_MODEL
}

afterEach(() => {
  clearAiEnvOverrides()
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY
  process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL
  process.env.OPENROUTER_MODEL = originalEnv.OPENROUTER_MODEL
  process.env.OPENROUTER_EMBEDDING_MODEL = originalEnv.OPENROUTER_EMBEDDING_MODEL
})

describe('getAiEnv', () => {
  it('returns defaults when optional variables are unset', () => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_BASE_URL
    delete process.env.OPENROUTER_MODEL
    delete process.env.OPENROUTER_EMBEDDING_MODEL

    const env = getAiEnv()

    expect(env.OPENROUTER_API_KEY).toBe('')
    expect(env.OPENROUTER_BASE_URL).toBe('')
    expect(env.OPENROUTER_MODEL).toBe('openai/gpt-4.1-mini')
    expect(env.OPENROUTER_EMBEDDING_MODEL).toBe('openai/text-embedding-3-small')
  })

  it('supports test overrides without mutating process env', () => {
    process.env.OPENROUTER_BASE_URL = 'https://live.example.test'
    setAiEnvOverride('OPENROUTER_BASE_URL', 'https://fake.example.test')

    expect(getAiEnv().OPENROUTER_BASE_URL).toBe('https://fake.example.test')
    expect(process.env.OPENROUTER_BASE_URL).toBe('https://live.example.test')

    clearAiEnvOverrides()

    expect(getAiEnv().OPENROUTER_BASE_URL).toBe('https://live.example.test')
  })
})

describe('getShadowingLlmEnv', () => {
  it('[INV-SHADOW-019] returns apiKey, baseUrl and model when all variables are set', () => {
    setAiEnvOverride('SHADOWING_LLM_API_KEY', 'sk-env-secret')
    setAiEnvOverride('SHADOWING_LLM_BASE_URL', 'https://api.openai.com/v1')
    setAiEnvOverride('SHADOWING_LLM_MODEL', 'gpt-4.1-mini')

    expect(getShadowingLlmEnv()).toEqual(
      Either.right({
        apiKey: 'sk-env-secret',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini'
      })
    )
  })

  it('[INV-SHADOW-019] fails naming only the missing variables and never the values', () => {
    setAiEnvOverride('SHADOWING_LLM_API_KEY', 'sk-env-secret')
    setAiEnvOverride('SHADOWING_LLM_BASE_URL', undefined)
    setAiEnvOverride('SHADOWING_LLM_MODEL', '  ')

    const result = getShadowingLlmEnv()

    if (Either.isRight(result)) {
      throw new Error('expected missing configuration')
    }
    expect(result.left._tag).toBe('ShadowingLlmNotConfiguredError')
    expect(result.left.missing).toEqual([
      'SHADOWING_LLM_BASE_URL',
      'SHADOWING_LLM_MODEL'
    ])
    expect(result.left.message).toContain('SHADOWING_LLM_BASE_URL')
    expect(result.left.message).toContain('SHADOWING_LLM_MODEL')
    expect(result.left.message).not.toContain('SHADOWING_LLM_API_KEY')
    expect(result.left.message).not.toContain('sk-env-secret')
  })

  it('does not affect the OpenRouter env', () => {
    setAiEnvOverride('SHADOWING_LLM_MODEL', 'gpt-4.1-mini')
    setAiEnvOverride('OPENROUTER_MODEL', undefined)

    expect(getAiEnv().OPENROUTER_MODEL).toBe('openai/gpt-4.1-mini')
  })
})
