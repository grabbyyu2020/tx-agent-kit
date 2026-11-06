import type { ApiFactoryContext } from './api-factories.js'

/** Seed an organization's credit balance directly in the DB (for billing integration tests). */
export const seedOrgCredits = async (
  context: ApiFactoryContext,
  orgId: string,
  creditsBalanceDecimillicents: number
): Promise<void> => {
  await context.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET credits_balance = $1, updated_at = now() WHERE id = $2`,
      [creditsBalanceDecimillicents, orgId]
    )
  })
}

/** Seed an organization's usage cap directly in the DB (for billing integration tests). */
export const seedOrgUsageCap = async (
  context: ApiFactoryContext,
  orgId: string,
  usageCapDecimillicents: number
): Promise<void> => {
  await context.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
      [usageCapDecimillicents, orgId]
    )
  })
}

/**
 * Activate a Pro subscription on an organization (direct DB update).
 * Used by tests that need upload/storage features which require a subscription.
 */
export const activateSubscription = async (
  organizationId: string
): Promise<void> => {
  const { Client } = await import('pg')
  const { getTestkitEnv } = await import('./env.js')
  const client = new Client({ connectionString: getTestkitEnv().DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `UPDATE organizations SET is_subscribed = true, subscription_status = 'active', subscription_plan = 'pro' WHERE id = $1`,
      [organizationId]
    )
  } finally {
    await client.end()
  }
}
