import { ApplicationFailure } from '@temporalio/common'
import type { ShadowingFailureReason } from '@tx-agent-kit/contracts'
import {
  classifyShadowingImportError,
  ShadowingImportService,
  ShadowingImportServiceLive,
  ShadowingLlmPortLive,
  ShadowingStorePortLive,
  YtDlpCaptionSourceLive,
  type PrepareShadowingTranscriptResult,
  type ShadowingImportError
} from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect, Either, Layer, Option } from 'effect'
import { getWorkerEnv } from './config/env.js'

const logger = createLogger('tx-agent-kit-worker-shadowing')

type ShadowingImportServiceApi = ShadowingImportService['Type']
type ShadowingLogContext = Readonly<Record<string, string | number>>

// Built per call so YT_DLP_PATH is read from the current worker env.
const shadowingLayer = () =>
  Layer.mergeAll(
    ShadowingImportServiceLive,
    ShadowingStorePortLive,
    YtDlpCaptionSourceLive(getWorkerEnv().YT_DLP_PATH),
    ShadowingLlmPortLive
  )

type ShadowingDeps = Layer.Layer.Success<ReturnType<typeof shadowingLayer>>

/**
 * Runs one ShadowingImportService use case. Domain failures become an
 * ApplicationFailure whose `type` is the failure reason (no_captions,
 * not_embeddable, import_error) so the workflow can store it; only failures
 * that can never succeed on retry are non-retryable.
 *
 * @spec INV-SHADOW-021
 */
const runShadowing = async <A>(
  activity: string,
  context: ShadowingLogContext,
  use: (service: ShadowingImportServiceApi) => Effect.Effect<A, ShadowingImportError, ShadowingDeps>
): Promise<A> => {
  const result = await Effect.runPromise(
    Effect.flatMap(ShadowingImportService, use).pipe(Effect.either, Effect.provide(shadowingLayer()))
  )
  if (Either.isRight(result)) {
    return result.right
  }

  const { reason, message, retryable } = classifyShadowingImportError(result.left)
  const failureContext = { ...context, outcome: 'failed', reason, errorTag: result.left._tag }
  if (retryable) {
    logger.warn(`Shadowing ${activity} failed; will retry.`, failureContext)
    throw ApplicationFailure.retryable(message, reason)
  }
  logger.info(`Shadowing ${activity} failed permanently.`, failureContext)
  throw ApplicationFailure.nonRetryable(message, reason)
}

export const shadowingActivities = {
  /** Captions → aligned sentences + segments stored; status → explaining. Returns counts only (Decision 3). */
  prepareShadowingTranscript: async (videoId: string): Promise<PrepareShadowingTranscriptResult> => {
    const result = await runShadowing('prepareShadowingTranscript', { videoId }, (service) => service.prepareTranscript(videoId))
    logger.info('Shadowing transcript prepared.', {
      videoId,
      outcome: result.outcome,
      ...(result.outcome === 'ok' ? { sentenceCount: result.sentenceCount } : {})
    })
    return result
  },

  /** Next batch to explain (prioritised first); null when nothing is pending or the video is gone. @spec INV-SHADOW-007 */
  nextShadowingExplanationBatch: async (videoId: string): Promise<{ batchIndex: number } | null> => {
    const next = await runShadowing('nextShadowingExplanationBatch', { videoId }, (service) => service.nextBatch(videoId))
    return Option.match(next, {
      onNone: () => null,
      onSome: (batchIndex) => ({ batchIndex })
    })
  },

  explainShadowingBatch: async (videoId: string, batchIndex: number): Promise<number> => {
    const stored = await runShadowing('explainShadowingBatch', { videoId, batchIndex }, (service) =>
      service.explainBatch(videoId, batchIndex)
    )
    logger.info('Shadowing explanation batch stored.', { videoId, batchIndex, outcome: 'ok', storedCount: stored })
    return stored
  },

  markShadowingBatchFailed: async (videoId: string, batchIndex: number): Promise<number> => {
    const failed = await runShadowing('markShadowingBatchFailed', { videoId, batchIndex }, (service) =>
      service.markBatchFailed(videoId, batchIndex)
    )
    logger.warn('Shadowing explanation batch marked failed.', { videoId, batchIndex, outcome: 'failed', failedCount: failed })
    return failed
  },

  failShadowingImport: async (videoId: string, reason: ShadowingFailureReason, message: string): Promise<void> => {
    await runShadowing('failShadowingImport', { videoId, reason }, (service) => service.failImport(videoId, reason, message))
    logger.info('Shadowing import failed.', { videoId, outcome: 'failed', reason })
  },

  markShadowingVideoReady: async (videoId: string): Promise<void> => {
    await runShadowing('markShadowingVideoReady', { videoId }, (service) => service.markReady(videoId))
    // markReady only moves explaining → ready, so this records the check, not the status.
    logger.info('Shadowing video ready check done.', { videoId, outcome: 'checked' })
  },

  regenerateShadowingExplanation: async (sentenceId: string): Promise<void> => {
    await runShadowing('regenerateShadowingExplanation', { sentenceId }, (service) => service.regenerate(sentenceId))
    logger.info('Shadowing explanation regenerated.', { sentenceId, outcome: 'ok' })
  },

  failShadowingRegeneration: async (sentenceId: string, message: string): Promise<void> => {
    await runShadowing('failShadowingRegeneration', { sentenceId }, (service) => service.failRegeneration(sentenceId, message))
    logger.warn('Shadowing explanation regeneration failed.', { sentenceId, outcome: 'failed' })
  }
}
