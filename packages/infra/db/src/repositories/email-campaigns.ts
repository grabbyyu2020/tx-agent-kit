import { and, asc, eq, sql, type SQL } from 'drizzle-orm'
import type { EmailCampaignStatus } from '@tx-agent-kit/contracts'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { emailCampaignRowSchema } from '../effect-schemas/email-campaigns.js'
import { toDbError } from '../errors.js'
import {
  emailCampaigns,
  emailSends,
  users,
  type JsonObject
} from '../schema.js'
import { createNullableDecoder } from './sql-helpers.js'

// The email-campaign repositories are split by aggregate into sibling modules;
// this file re-exports them so `./repositories/email-campaigns.js` stays the
// single import path for every email-campaign repository and decoder.
export {
  decodeStepRows,
  decodeNullableStep,
  campaignStepRepository
} from './email-campaign-steps.js'
export { decodeNullableEnrollment, enrollmentRepository } from './email-campaign-enrollments.js'
export { decodeNullableSend, emailSendRepository } from './email-sends.js'
export {
  decodeNullableUnsubscribe,
  unsubscribeRepository,
  suppressionRepository
} from './email-suppression.js'

// ---------------------------------------------------------------------------
// Effect schema decoders — validate DB rows at runtime boundaries
// ---------------------------------------------------------------------------

const decodeCampaignRows = Schema.decodeUnknown(Schema.Array(emailCampaignRowSchema))
const decodeNullableCampaign = createNullableDecoder(emailCampaignRowSchema, 'email campaign row')

export {
  decodeCampaignRows,
  decodeNullableCampaign
}

// ---------------------------------------------------------------------------
// Row-to-domain mapping helpers
// ---------------------------------------------------------------------------

type CampaignRow = typeof emailCampaigns.$inferSelect

const toCampaignRecord = (row: CampaignRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  campaignType: row.campaignType,
  status: row.status,
  triggerConfig: row.triggerConfig,
  audienceFilter: row.audienceFilter,
  fromName: row.fromName,
  replyTo: row.replyTo,
  slug: row.slug,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

// ---------------------------------------------------------------------------
// campaignRepository
// ---------------------------------------------------------------------------

export const campaignRepository = {
  create: (input: {
    name: string
    description?: string | null
    campaignType: CampaignRow['campaignType']
    status?: EmailCampaignStatus
    triggerConfig?: unknown
    audienceFilter?: unknown
    fromName?: string | null
    replyTo?: string | null
    slug?: string | null
    createdBy?: string | null
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailCampaigns)
          .values({
            name: input.name,
            description: input.description ?? null,
            campaignType: input.campaignType,
            ...(input.status !== undefined ? { status: input.status } : {}),
            triggerConfig: (input.triggerConfig ?? null) as JsonObject | null,
            audienceFilter: (input.audienceFilter ?? null) as JsonObject | null,
            fromName: input.fromName ?? null,
            replyTo: input.replyTo ?? null,
            slug: input.slug ?? null,
            createdBy: input.createdBy ?? null
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toCampaignRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create email campaign', error))),

  findById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(eq(emailCampaigns.id, id))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toCampaignRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch email campaign by id', error))),

  findBySlug: (slug: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(eq(emailCampaigns.slug, slug))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toCampaignRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch email campaign by slug', error))),

  findMany: (filter: { status?: EmailCampaignStatus; campaignType?: CampaignRow['campaignType'] }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const predicates: SQL[] = []

        if (filter.status) {
          predicates.push(eq(emailCampaigns.status, filter.status))
        }
        if (filter.campaignType) {
          predicates.push(eq(emailCampaigns.campaignType, filter.campaignType))
        }

        const whereClause = predicates.length > 0 ? and(...predicates) : undefined

        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(whereClause)
          .orderBy(asc(emailCampaigns.createdAt))
          .execute()

        return rows.map(toCampaignRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list email campaigns', error))),

  updateById: (
    id: string,
    input: {
      name?: string
      description?: string | null
      triggerConfig?: unknown
      audienceFilter?: unknown
      fromName?: string | null
      replyTo?: string | null
      slug?: string | null
      status?: EmailCampaignStatus
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()` }

        if (input.name !== undefined) { patch.name = input.name }
        if (input.description !== undefined) { patch.description = input.description }
        if (input.triggerConfig !== undefined) { patch.triggerConfig = input.triggerConfig }
        if (input.audienceFilter !== undefined) { patch.audienceFilter = input.audienceFilter }
        if (input.fromName !== undefined) { patch.fromName = input.fromName }
        if (input.replyTo !== undefined) { patch.replyTo = input.replyTo }
        if (input.slug !== undefined) { patch.slug = input.slug }
        if (input.status !== undefined) { patch.status = input.status }

        const rows = yield* db
          .update(emailCampaigns)
          .set(patch)
          .where(eq(emailCampaigns.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toCampaignRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update email campaign', error))),

  findActiveByCampaignTrigger: (triggerConfig: unknown) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaigns)
          .where(
            and(
              eq(emailCampaigns.status, 'active'),
              sql`${emailCampaigns.triggerConfig} @> ${JSON.stringify(triggerConfig)}::jsonb`
            )
          )
          .execute()

        return rows.map(toCampaignRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to find active campaigns by trigger', error)))
}

// ---------------------------------------------------------------------------
// audienceRepository
// ---------------------------------------------------------------------------

export const audienceRepository = {
  resolveAllUsers: () =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({
            userId: users.id,
            email: users.email,
            name: users.name
          })
          .from(users)
          .execute()

        return rows
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to resolve audience users', error))),

  updateSendResendMessageId: (sendId: string, resendMessageId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        yield* db
          .update(emailSends)
          .set({ resendMessageId })
          .where(eq(emailSends.id, sendId))
          .execute()
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update email send resend message id', error)))
}
