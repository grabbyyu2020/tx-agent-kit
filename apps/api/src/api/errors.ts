import { createLogger } from '@tx-agent-kit/logging'
import {
  causeLogContext,
  findRootCauseError,
  shouldLogEffectCause
} from '@tx-agent-kit/observability/effect-cause-summary'
import * as Schema from 'effect/Schema'
import {
  getApiRequestContext,
  markApiErrorReported
} from '../observability/request-context.js'
import { captureApiMappedError } from '../observability/sentry.js'

export class BadRequest extends Schema.TaggedError<BadRequest>()('BadRequest', {
  message: Schema.String
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  message: Schema.String
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()('Conflict', {
  message: Schema.String
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  message: Schema.String
}) {}

export class PaymentRequired extends Schema.TaggedError<PaymentRequired>()('PaymentRequired', {
  message: Schema.String
}) {}

export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()('TooManyRequests', {
  message: Schema.String
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()('InternalError', {
  message: Schema.String
}) {}

const apiLogger = createLogger('tx-agent-kit-api')

type MappedCoreError = BadRequest | Unauthorized | Forbidden | PaymentRequired | NotFound | Conflict | InternalError

const isTaggedErrorLike = (
  error: unknown
): error is { _tag: string; code?: string; message?: string; cause?: unknown } =>
  typeof error === 'object' && error !== null && '_tag' in error

// UNAUTHORIZED failures whose root cause is an expected JWT/JWS condition
// (expired/invalid token) are ordinary client noise, not a server fault — they
// are logged at warn and never sent to Sentry.
const expectedUnauthorizedRootCauseTags = new Set([
  'JWTExpired',
  'JWTClaimValidationFailed',
  'JWTInvalid',
  'JWSInvalid',
  'JWSSignatureVerificationFailed'
])

const isExpectedUnauthorizedAuthFailure = (error: { code?: string; cause?: unknown }): boolean => {
  if (error.code !== 'UNAUTHORIZED') {
    return false
  }

  const context = causeLogContext(error.cause)
  const rootCauseTag = typeof context.rootCauseTag === 'string' ? context.rootCauseTag : undefined
  const rootCauseType = typeof context.rootCauseType === 'string' ? context.rootCauseType : undefined

  return (
    (rootCauseTag !== undefined && expectedUnauthorizedRootCauseTags.has(rootCauseTag)) ||
    (rootCauseType !== undefined && expectedUnauthorizedRootCauseTags.has(rootCauseType))
  )
}

// A mapping is report-worthy (error level + Sentry) when it is a 500, an
// unmapped/unknown code, or its Effect cause is itself reportable. Everything
// else is an expected client error → warn, no Sentry.
const shouldCaptureCoreErrorMapping = (
  error: { code?: string; cause?: unknown },
  expectedUnauthorizedAuthFailure = isExpectedUnauthorizedAuthFailure(error)
): boolean => {
  if (expectedUnauthorizedAuthFailure) {
    return false
  }

  return error.code === 'INTERNAL_ERROR' || error.code === undefined || shouldLogEffectCause(error.cause)
}

// PRIMARY error boundary: log each mapped CoreError exactly once (5xx/unknown →
// error + Sentry, expected 4xx → warn), enriched with the active request
// context, then mark the request so the last-resort effectCauseLoggingMiddleware
// skips it (no double-log). See middleware/effect-cause-logging.ts.
const logCoreErrorMapping = (
  error: { _tag: string; code?: string; message?: string; cause?: unknown },
  httpErrorTag: MappedCoreError['_tag']
): void => {
  const causeContext = causeLogContext(error.cause)
  const context = {
    ...getApiRequestContext(),
    tag: error._tag,
    code: error.code,
    httpErrorTag,
    message: error.message,
    ...causeContext
  }
  const expectedUnauthorizedAuthFailure = isExpectedUnauthorizedAuthFailure(error)
  const reportWorthy = shouldCaptureCoreErrorMapping(error, expectedUnauthorizedAuthFailure)
  const logMessage = typeof causeContext.rootCauseMessage === 'string'
    ? causeContext.rootCauseMessage
    : error.message ?? 'CoreError mapped to HTTP error'

  if (reportWorthy) {
    apiLogger.error(logMessage, context)
    captureApiMappedError(findRootCauseError(error.cause) ?? new Error(logMessage), context)
  } else if (expectedUnauthorizedAuthFailure) {
    // An expected token/session expiry is informational, not a warning. The
    // redacted cause chain still appears in the info log for diagnosis, but it
    // is not warn/error-level noise and is never sent to Sentry.
    apiLogger.info(logMessage, context)
  } else {
    apiLogger.warn(logMessage, context)
  }

  // This request's fault is now logged at the boundary; tell the last-resort
  // effect-cause middleware to skip it so we never double-log the same error.
  markApiErrorReported()
}

export const mapCoreError = (error: unknown): MappedCoreError => {
  if (error && typeof error === 'object' && '_tag' in error) {
    const e = error as { _tag: string; code?: string; message?: string; cause?: unknown }

    // Pass through already-mapped API error types (idempotent when double-mapped)
    switch (e._tag) {
      case 'BadRequest':
        return error as BadRequest
      case 'Unauthorized':
        return error as Unauthorized
      case 'Forbidden':
        return error as Forbidden
      case 'PaymentRequired':
        return error as PaymentRequired
      case 'NotFound':
        return error as NotFound
      case 'Conflict':
        return error as Conflict
      case 'InternalError':
        return error as InternalError
    }

    const message = e.message ?? 'Internal server error'

    switch (e.code) {
      case 'BAD_REQUEST':
        logCoreErrorMapping(e, 'BadRequest')
        return new BadRequest({ message })
      case 'UNAUTHORIZED':
        logCoreErrorMapping(e, 'Unauthorized')
        return new Unauthorized({ message })
      case 'FORBIDDEN':
        logCoreErrorMapping(e, 'Forbidden')
        return new Forbidden({ message })
      case 'PAYMENT_REQUIRED':
        logCoreErrorMapping(e, 'PaymentRequired')
        return new PaymentRequired({ message })
      case 'NOT_FOUND':
        logCoreErrorMapping(e, 'NotFound')
        return new NotFound({ message })
      case 'CONFLICT':
        logCoreErrorMapping(e, 'Conflict')
        return new Conflict({ message })
      case 'INTERNAL_ERROR':
        logCoreErrorMapping(e, 'InternalError')
        return new InternalError({ message: 'Internal server error' })
      case undefined:
      default:
        logCoreErrorMapping(e, 'InternalError')
        return new InternalError({ message: 'Internal server error' })
    }
  }

  const context = {
    ...getApiRequestContext(),
    ...causeLogContext(error)
  }
  apiLogger.error('Non-CoreError fell through to 500', context)
  captureApiMappedError(new Error('Non-CoreError fell through to 500'), context)
  markApiErrorReported()
  return new InternalError({ message: 'Internal server error' })
}

// Request-BODY decode failures are client errors, not server faults. Effect Schema
// raises a `ParseError` (and `schemaBodyJson` a `RequestError` for malformed JSON);
// both must become a 400 BadRequest and be logged at `warn` - NOT routed through
// `mapCoreError`'s default branch, which would mislabel them as a reportworthy 500
// InternalError and flood Sentry with useless Effect-internals stacks. Use this for
// manual `HttpServerRequest.schemaBodyJson(...)` decodes in handlers; the framework's
// `.handle({ payload })` path already returns a 400 automatically. Non-body errors
// still defer to `mapCoreError` so genuine faults are reported.
export const mapRequestBodyError = (error: unknown): MappedCoreError => {
  if (isTaggedErrorLike(error) && (error._tag === 'ParseError' || error._tag === 'RequestError')) {
    const detail = typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : 'request body validation failed'
    apiLogger.warn('Rejected malformed request body', {
      ...getApiRequestContext(),
      tag: error._tag,
      httpErrorTag: 'BadRequest',
      message: detail
    })
    markApiErrorReported()
    return new BadRequest({ message: 'Invalid request body.' })
  }
  return mapCoreError(error)
}
