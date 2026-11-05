// Failure mapping for the shadowing workflows in workflows.ts. Bundled into the
// workflow sandbox, so it must stay pure: no IO, clock or randomness.
import { ActivityFailure, ApplicationFailure } from '@temporalio/common'
import type { ShadowingFailureReason } from '@tx-agent-kit/contracts'

const shadowingFailureReasons: ReadonlyArray<ShadowingFailureReason> = [
  'no_captions',
  'not_embeddable',
  'import_error'
]

const applicationFailureOf = (error: unknown): ApplicationFailure | undefined => {
  if (error instanceof ApplicationFailure) {
    return error
  }
  return error instanceof ActivityFailure && error.cause instanceof ApplicationFailure
    ? error.cause
    : undefined
}

/**
 * The failure reason an activity reported as its ApplicationFailure `type`
 * when it is a known reason, else `import_error` (e.g. a timeout).
 *
 * @spec INV-SHADOW-021
 */
export const shadowingFailureReasonOf = (error: unknown): ShadowingFailureReason => {
  const type = applicationFailureOf(error)?.type
  return shadowingFailureReasons.find((reason) => reason === type) ?? 'import_error'
}

/** The activity's own failure message rather than Temporal's "Activity task failed" wrapper. */
export const shadowingFailureMessageOf = (error: unknown): string =>
  applicationFailureOf(error)?.message
  ?? (error instanceof Error ? error.message : String(error))
