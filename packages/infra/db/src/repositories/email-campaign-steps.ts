import { asc, eq, inArray, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { emailCampaignStepRowSchema } from '../effect-schemas/email-campaign-steps.js'
import { toDbError } from '../errors.js'
import { emailCampaignSteps, type JsonObject } from '../schema.js'
import { createNullableDecoder } from './sql-helpers.js'

// ---------------------------------------------------------------------------
// Effect schema decoders — validate DB rows at runtime boundaries
// ---------------------------------------------------------------------------

const decodeStepRows = Schema.decodeUnknown(Schema.Array(emailCampaignStepRowSchema))
const decodeNullableStep = createNullableDecoder(emailCampaignStepRowSchema, 'email campaign step row')

export {
  decodeStepRows,
  decodeNullableStep
}

// ---------------------------------------------------------------------------
// Row-to-domain mapping helpers
// ---------------------------------------------------------------------------

type CampaignStepRow = typeof emailCampaignSteps.$inferSelect

const toStepRecord = (row: CampaignStepRow) => ({
  id: row.id,
  campaignId: row.campaignId,
  stepOrder: row.stepOrder,
  subject: row.subject,
  templateId: row.templateId,
  templateData: row.templateData,
  delaySeconds: row.delaySeconds,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

// ---------------------------------------------------------------------------
// campaignStepRepository
// ---------------------------------------------------------------------------

export const campaignStepRepository = {
  create: (input: {
    campaignId: string
    stepOrder: number
    subject: string
    templateId: string
    templateData?: unknown
    delaySeconds?: number
  }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(emailCampaignSteps)
          .values({
            campaignId: input.campaignId,
            stepOrder: input.stepOrder,
            subject: input.subject,
            templateId: input.templateId,
            templateData: (input.templateData ?? {}) as JsonObject,
            delaySeconds: input.delaySeconds ?? 0
          })
          .returning()
          .execute()

        const row = rows[0]
        if (!row) {
          return null
        }

        return toStepRecord(row)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to create campaign step', error))),

  findByCampaign: (campaignId: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(eq(emailCampaignSteps.campaignId, campaignId))
          .orderBy(asc(emailCampaignSteps.stepOrder))
          .execute()

        return rows.map(toStepRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list campaign steps', error))),

  /**
   * Batch the steps for several campaigns in one query (ordered by campaign then
   * step order). The caller groups by `campaignId`; within a campaign the steps
   * stay in step order. Used by the drip sweep to avoid one query per enrollment.
   */
  findByCampaigns: (campaignIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (campaignIds.length === 0) {
          return []
        }
        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(inArray(emailCampaignSteps.campaignId, [...campaignIds]))
          .orderBy(asc(emailCampaignSteps.campaignId), asc(emailCampaignSteps.stepOrder))
          .execute()

        return rows.map(toStepRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to list campaign steps for campaigns', error))),

  findById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(eq(emailCampaignSteps.id, id))
          .limit(1)
          .execute()

        const row = rows[0]
        return row ? toStepRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch campaign step by id', error))),

  updateById: (
    id: string,
    input: {
      subject?: string
      templateId?: string
      templateData?: unknown
      delaySeconds?: number
    }
  ) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const patch: Record<string, unknown> = { updatedAt: sql`now()` }

        if (input.subject !== undefined) { patch.subject = input.subject }
        if (input.templateId !== undefined) { patch.templateId = input.templateId }
        if (input.templateData !== undefined) { patch.templateData = input.templateData }
        if (input.delaySeconds !== undefined) { patch.delaySeconds = input.delaySeconds }

        const rows = yield* db
          .update(emailCampaignSteps)
          .set(patch)
          .where(eq(emailCampaignSteps.id, id))
          .returning()
          .execute()

        const row = rows[0]
        return row ? toStepRecord(row) : null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to update campaign step', error))),

  deleteById: (id: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        yield* db
          .delete(emailCampaignSteps)
          .where(eq(emailCampaignSteps.id, id))
          .execute()

        return { deleted: true as const }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to delete campaign step', error))),

  reorder: (campaignId: string, stepIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        if (stepIds.length > 0) {
          // Bulk UPDATE using a VALUES list instead of N individual updates
          const valuesList = stepIds
            .map((id, i) => sql`(${id}::uuid, ${i + 1})`)
            .reduce((acc, v) => sql`${acc}, ${v}`)

          yield* db.execute(
            sql`UPDATE ${emailCampaignSteps}
                SET step_order = v.new_order, updated_at = now()
                FROM (VALUES ${valuesList}) AS v(id, new_order)
                WHERE ${emailCampaignSteps.id} = v.id
                  AND ${emailCampaignSteps.campaignId} = ${campaignId}`
          )
        }

        const rows = yield* db
          .select()
          .from(emailCampaignSteps)
          .where(eq(emailCampaignSteps.campaignId, campaignId))
          .orderBy(asc(emailCampaignSteps.stepOrder))
          .execute()

        return rows.map(toStepRecord)
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to reorder campaign steps', error)))
}
