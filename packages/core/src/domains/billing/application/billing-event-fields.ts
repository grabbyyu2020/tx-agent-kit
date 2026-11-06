import type { SubscriptionPlanSlug } from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import type { CoreError } from '../../../errors.js'
import type { JsonObject, SubscriptionStatus } from '../domain/billing-domain.js'

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const readObjectField = (record: JsonObject, key: string): JsonObject | null => {
  const value = record[key]
  return isJsonObject(value) ? value : null
}

export const readStringField = (record: JsonObject, key: string): string | null => {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export const collectSubscriptionPriceIds = (record: JsonObject): ReadonlyArray<string> => {
  const items = readObjectField(record, 'items')
  if (!items) {
    return []
  }

  const data = items.data
  if (!Array.isArray(data)) {
    return []
  }

  const priceIds: Array<string> = []
  for (const item of data) {
    if (!isJsonObject(item)) {
      continue
    }

    const price = readObjectField(item, 'price')
    const priceId = price ? readStringField(price, 'id') : null
    if (priceId) {
      priceIds.push(priceId)
    }
  }

  return priceIds
}

export const readNumberField = (record: JsonObject, key: string): number | null => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Convert a Stripe `cents` field from an event payload into our
 * internal `decimillicents` unit (1 cent = 100_000 decimillicents).
 *
 * Stripe amounts are non-negative integer minor units, but the
 * handler still has to defend against:
 *   - NaN / Infinity (filtered by readNumberField, but belt-and-
 *     suspenders in case the caller bypasses it).
 *   - Fractional cents (fail loudly — we've never seen this from
 *     Stripe but a schema drift would corrupt the bigint ledger).
 *   - Negative cents (a refund-shaped event reaching a credit
 *     path would apply as a positive debit with flipped sign).
 *   - `cents * 100_000` overflowing `Number.MAX_SAFE_INTEGER`
 *     (9.007e15). The worst case is ~$900M in cents; Stripe's
 *     enterprise cap is right at that edge, so the multiplication
 *     is done with BigInt and the result range-checked before
 *     narrowing to Number for the bigint column.
 *
 * Returns `null` when the field is missing or malformed so the
 * caller can branch the same way it does with `readNumberField`.
 */
export const readCentsAsDecimillicents = (
  record: JsonObject,
  key: string
): number | null => {
  const cents = readNumberField(record, key)
  if (cents === null) { return null }
  if (!Number.isInteger(cents) || cents < 0) { return null }
  const asDmc = BigInt(cents) * 100_000n
  if (asDmc > BigInt(Number.MAX_SAFE_INTEGER)) { return null }
  return Number(asDmc)
}

export const parseSubscriptionStatus = (value: string | null): SubscriptionStatus | null => {
  if (!value) {
    return null
  }

  switch (value) {
    case 'active':
    case 'inactive':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'paused':
    case 'unpaid':
      return value
    default:
      return null
  }
}

export const parseSubscriptionPlan = (value: string | null): SubscriptionPlanSlug | null => {
  if (value === null) {
    return null
  }

  switch (value) {
    case 'try_me':
    case 'pro':
    case 'agency':
      return value
    default:
      return null
  }
}

export const toDateFromUnixSeconds = (value: number | null): Date | null =>
  typeof value === 'number' ? new Date(value * 1000) : null

const resolveOrganizationIdFromEvent = (object: JsonObject): string | null => {
  const metadata = readObjectField(object, 'metadata')
  const metadataOrgId = metadata
    ? readStringField(metadata, 'organizationId') ?? readStringField(metadata, 'organization_id')
    : null

  if (metadataOrgId) {
    return metadataOrgId
  }

  return readStringField(object, 'client_reference_id')
}

export const resolveOrganizationIdForEvent = (
  object: JsonObject,
  lookupBySubscriptionId: (subscriptionId: string) => Effect.Effect<string | null, CoreError>,
  lookupByCustomerId: (customerId: string) => Effect.Effect<string | null, CoreError>
): Effect.Effect<string | null, CoreError> =>
  Effect.gen(function* () {
    const direct = resolveOrganizationIdFromEvent(object)
    if (direct) {
      return direct
    }

    const subscriptionId = readStringField(object, 'subscription') ?? readStringField(object, 'id')
    if (subscriptionId) {
      const bySubscription = yield* lookupBySubscriptionId(subscriptionId)
      if (bySubscription) {
        return bySubscription
      }
    }

    const customerId = readStringField(object, 'customer')
    if (customerId) {
      return yield* lookupByCustomerId(customerId)
    }

    return null
  })
