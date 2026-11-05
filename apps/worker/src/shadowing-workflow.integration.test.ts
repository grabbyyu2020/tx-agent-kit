/**
 * Orchestration of shadowingImportWorkflow / shadowingRegenerateWorkflow on a
 * real Temporal worker (local dev server) with in-memory stub activities, so the
 * production retry policies (5 s initial interval, backoff 2) are exercised as-is.
 *
 * @spec youtube-shadowing-design §"Workflows and Activities"
 */
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@temporalio/activity'
import { Client } from '@temporalio/client'
import { ApplicationFailure } from '@temporalio/common'
import { NativeConnection, Worker } from '@temporalio/worker'
import { buildSerializedDomainEvent } from '@tx-agent-kit/testkit'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getWorkerEnv, resolveWorkerTemporalConnectionOptions } from './config/env.js'
import type { shadowingActivities } from './shadowing-activities.js'

interface Scenario {
  readonly prepare: 'ok' | 'gone' | 'no_captions' | 'error'
  /** Batches in the order the (stubbed) database would select them. */
  readonly pending: number[]
  readonly failingBatches: ReadonlySet<number>
  readonly log: string[]
}

const scenarios = new Map<string, Scenario>()

const scenarioFor = (id: string): Scenario => {
  const scenario = scenarios.get(id)
  if (!scenario) {
    throw new Error(`No scenario for ${id}`)
  }
  return scenario
}

const removePending = (scenario: Scenario, batchIndex: number): void => {
  const position = scenario.pending.indexOf(batchIndex)
  if (position >= 0) {
    scenario.pending.splice(position, 1)
  }
}

const stubActivities: typeof shadowingActivities = {
  prepareShadowingTranscript: async (videoId) => {
    const scenario = scenarioFor(videoId)
    scenario.log.push('prepare')
    if (scenario.prepare === 'no_captions') {
      throw ApplicationFailure.nonRetryable(`Video ${videoId} has no English captions`, 'no_captions')
    }
    if (scenario.prepare === 'error') {
      throw new Error('yt-dlp failed with exit code 1: HTTP Error 429')
    }
    return await Promise.resolve(
      scenario.prepare === 'gone' ? { outcome: 'gone' } : { outcome: 'ok', sentenceCount: scenario.pending.length * 20 }
    )
  },
  nextShadowingExplanationBatch: async (videoId) => {
    const next = scenarioFor(videoId).pending[0]
    return await Promise.resolve(next === undefined ? null : { batchIndex: next })
  },
  explainShadowingBatch: async (videoId, batchIndex) => {
    const scenario = scenarioFor(videoId)
    scenario.log.push(`explain:${batchIndex}#${Context.current().info.attempt}`)
    if (scenario.failingBatches.has(batchIndex)) {
      throw new Error(`LLM endpoint returned HTTP 503 for batch ${batchIndex}`)
    }
    removePending(scenario, batchIndex)
    return await Promise.resolve(20)
  },
  markShadowingBatchFailed: async (videoId, batchIndex) => {
    const scenario = scenarioFor(videoId)
    scenario.log.push(`failed:${batchIndex}`)
    removePending(scenario, batchIndex)
    return await Promise.resolve(20)
  },
  failShadowingImport: async (videoId, reason, message) => {
    scenarioFor(videoId).log.push(`failImport:${reason}:${message}`)
    await Promise.resolve()
  },
  markShadowingVideoReady: async (videoId) => {
    scenarioFor(videoId).log.push('ready')
    await Promise.resolve()
  },
  regenerateShadowingExplanation: async (sentenceId) => {
    const scenario = scenarioFor(sentenceId)
    scenario.log.push('regenerate')
    if (scenario.failingBatches.size > 0) {
      throw ApplicationFailure.nonRetryable('LLM is not configured; missing environment variables: SHADOWING_LLM_MODEL', 'import_error')
    }
    await Promise.resolve()
  },
  failShadowingRegeneration: async (sentenceId, message) => {
    scenarioFor(sentenceId).log.push(`failRegeneration:${message}`)
    await Promise.resolve()
  }
}

let connection: NativeConnection | undefined
let client: Client | undefined
let worker: Worker | undefined
let workerRun: Promise<void> | undefined
const taskQueue = `tx-agent-kit-shadowing-workflow-${randomUUID()}`

beforeAll(async () => {
  const env = getWorkerEnv()
  connection = await NativeConnection.connect(resolveWorkerTemporalConnectionOptions(env))
  client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE })
  worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue,
    workflowsPath: resolve(dirname(fileURLToPath(import.meta.url)), 'workflows.ts'),
    activities: stubActivities
  })
  workerRun = worker.run()
}, 120_000)

afterAll(async () => {
  worker?.shutdown()
  await workerRun
  await connection?.close()
})

const runWorkflow = async (
  workflowType: 'shadowingImportWorkflow' | 'shadowingRegenerateWorkflow',
  scenario: Omit<Scenario, 'log'>
): Promise<string[]> => {
  if (!client) {
    throw new Error('Temporal client was not initialized')
  }
  const id = randomUUID()
  const log: string[] = []
  scenarios.set(id, { ...scenario, pending: [...scenario.pending], log })
  const event = buildSerializedDomainEvent({
    eventType: workflowType === 'shadowingImportWorkflow'
      ? 'shadowing.video_import_requested'
      : 'shadowing.explanation_regenerate_requested',
    aggregateType: 'shadowing',
    aggregateId: id,
    payload: workflowType === 'shadowingImportWorkflow'
      ? { videoId: id, userId: randomUUID() }
      : { videoId: randomUUID(), sentenceId: id }
  })
  await client.workflow.execute(workflowType, {
    taskQueue,
    workflowId: `${workflowType}-test-${id}`,
    args: [event],
    workflowRunTimeout: '2 minutes'
  })
  return log
}

const ok = { prepare: 'ok', failingBatches: new Set<number>() } as const

// Concurrent: the retry cases each wait ~15 s of real Temporal backoff (5 s, 10 s).
describe.concurrent('shadowing workflows', () => {
  it('explains all batches in order [INV-SHADOW-007]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, pending: [0, 1, 2] })

    expect(log).toEqual(['prepare', 'explain:0#1', 'ready', 'explain:1#1', 'explain:2#1', 'ready'])
  })

  it('follows the batch the database selects next [INV-SHADOW-007]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, pending: [0, 3, 1, 2] })

    expect(log).toEqual(['prepare', 'explain:0#1', 'ready', 'explain:3#1', 'explain:1#1', 'explain:2#1', 'ready'])
  })

  it('retries a failing batch three times [INV-SHADOW-022]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, pending: [0], failingBatches: new Set([0]) })

    expect(log).toEqual(['prepare', 'explain:0#1', 'explain:0#2', 'explain:0#3', 'failed:0', 'ready', 'ready'])
  }, 60_000)

  it('marks a batch failed and continues [INV-SHADOW-022]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, pending: [0, 1, 2], failingBatches: new Set([1]) })

    expect(log).toEqual([
      'prepare',
      'explain:0#1',
      'ready',
      'explain:1#1',
      'explain:1#2',
      'explain:1#3',
      'failed:1',
      'explain:2#1',
      'ready'
    ])
  }, 60_000)

  it('marks the video ready after batch 0 while later batches are pending [INV-SHADOW-011]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, pending: [0, 1] })

    expect(log.indexOf('ready')).toBe(log.indexOf('explain:0#1') + 1)
    expect(log.indexOf('ready')).toBeLessThan(log.indexOf('explain:1#1'))
  })

  it('fails the import with no_captions when prepare fails permanently [INV-SHADOW-021]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, prepare: 'no_captions', pending: [0] })

    expect(log).toHaveLength(2)
    expect(log[0]).toBe('prepare')
    expect(log[1]).toMatch(/^failImport:no_captions:Video .+ has no English captions$/)
  })

  it('fails the import with import_error after prepare exhausts its retries [INV-SHADOW-021]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, prepare: 'error', pending: [0] })

    expect(log).toEqual([
      'prepare',
      'prepare',
      'prepare',
      'failImport:import_error:yt-dlp failed with exit code 1: HTTP Error 429'
    ])
  }, 60_000)

  it('returns without explaining when the video is gone [INV-SHADOW-007]', async () => {
    const log = await runWorkflow('shadowingImportWorkflow', { ...ok, prepare: 'gone', pending: [0] })

    expect(log).toEqual(['prepare'])
  })

  it('marks a failed regeneration with the failure message [INV-SHADOW-012]', async () => {
    const failing = await runWorkflow('shadowingRegenerateWorkflow', { ...ok, pending: [], failingBatches: new Set([0]) })
    const succeeding = await runWorkflow('shadowingRegenerateWorkflow', { ...ok, pending: [] })

    expect(failing).toEqual([
      'regenerate',
      'failRegeneration:LLM is not configured; missing environment variables: SHADOWING_LLM_MODEL'
    ])
    expect(succeeding).toEqual(['regenerate'])
  })
})
