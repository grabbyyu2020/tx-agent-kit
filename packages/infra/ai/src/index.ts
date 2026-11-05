export {
  clearAiEnvOverrides,
  getAiEnv,
  getShadowingLlmEnv,
  setAiEnvOverride,
  ShadowingLlmNotConfiguredError,
  type AiEnv,
  type AiEnvKey,
  type ShadowingLlmEnv
} from './env.js'
export {
  ChatCompletionError,
  ChatCompletionErrorReason,
  chatCompletionsJson,
  type ChatCompletionMessage,
  type ChatCompletionOptions,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatCompletionUsage
} from './openai-compatible.js'
export { AiError } from './errors.js'
export {
  callModel,
  resetOpenRouterClientForTests,
  setOpenRouterHttpClientForTests
} from './openrouter.js'
export {
  embeddingsGenerate,
  resetEmbeddingsClientForTests,
  setEmbeddingsHttpClientForTests
} from './embeddings.js'
export {
  tracedCallModel,
  withAgentStep,
  withAgentTrace
} from './tracing.js'
export type { TracedCallModelOptions } from './tracing.js'
export type * from '@openrouter/sdk'
export type * from './openrouter.js'
export type * from './embeddings.js'
