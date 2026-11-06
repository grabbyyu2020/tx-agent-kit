import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex
} from 'drizzle-orm/pg-core'
import { users } from './auth.js'
import { creditLedger } from './billing.js'
import {
  assetCategoryEnum,
  assetTypeEnum,
  pendingUploadStatusEnum,
  processingStatusEnum
} from './enums.js'
import type { JsonObject } from './json.js'
import { organizations, teams } from './organizations.js'

// ---------------------------------------------------------------------------
// Assets domain tables
// ---------------------------------------------------------------------------

export const teamMediaAssets = pgTable('team_media_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  originalFilename: text('original_filename').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  mimeType: text('mime_type').notNull(),
  assetType: assetTypeEnum('asset_type').notNull(),
  assetCategory: assetCategoryEnum('asset_category').notNull().default('user_upload'),
  assetTypeData: jsonb('asset_type_data').$type<JsonObject>(),
  storagePath: text('storage_path').notNull(),
  thumbnailPath: text('thumbnail_path'),
  aiTitle: text('ai_title'),
  aiDescription: text('ai_description'),
  aiTags: text('ai_tags').array().notNull().default(sql`'{}'`),
  contentCategory: text('content_category'),
  emotion: jsonb('emotion').$type<JsonObject>(),
  purpose: text('purpose').array().notNull().default(sql`'{}'`),
  contentHash: text('content_hash'),
  processingStatus: processingStatusEnum('processing_status').notNull().default('pending'),
  processingError: text('processing_error'),
  embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
  embeddingModel: text('embedding_model'),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  hardDeletedAt: timestamp('hard_deleted_at', { withTimezone: true }),
  sharedWithOrg: boolean('shared_with_org').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('team_media_assets_team_id_is_deleted_idx').on(table.teamId, table.isDeleted),
  uniqueIndex('team_media_assets_team_content_hash_unique')
    .on(table.teamId, table.contentHash)
    .where(sql`is_deleted = false AND content_hash IS NOT NULL`),
  index('team_media_assets_team_created_at_idx').on(table.teamId, table.createdAt),
  index('team_media_assets_retention_scan_idx')
    .on(table.deletedAt)
    .where(sql`is_deleted = true AND hard_deleted_at IS NULL`)
])

export const pendingUploads = pgTable('pending_uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  declaredFileSize: bigint('declared_file_size', { mode: 'number' }).notNull(),
  contentHash: text('content_hash'),
  mimeType: text('mime_type').notNull(),
  storagePath: text('storage_path').notNull(),
  presignedUrl: text('presigned_url').notNull(),
  status: pendingUploadStatusEnum('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('pending_uploads_team_id_idx').on(table.teamId),
  index('pending_uploads_status_expires_at_idx')
    .on(table.status, table.expiresAt)
    .where(sql`${table.status} = 'pending'`)
])

export const storageMetering = pgTable('storage_metering', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }).unique(),
  activeBytes: bigint('active_bytes', { mode: 'number' }).notNull().default(0),
  softDeletedBytes: bigint('soft_deleted_bytes', { mode: 'number' }).notNull().default(0),
  activeAssetCount: integer('active_asset_count').notNull().default(0),
  softDeletedAssetCount: integer('soft_deleted_asset_count').notNull().default(0),
  highWaterMarkBytes: bigint('high_water_mark_bytes', { mode: 'number' }).notNull().default(0),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow()
})

export const mediaCollections = pgTable('media_collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('media_collections_team_id_idx').on(table.teamId),
  index('media_collections_team_name_idx').on(table.teamId, table.name)
])

export const collectionAssets = pgTable('collection_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id').notNull().references(() => mediaCollections.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => teamMediaAssets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('collection_assets_collection_asset_unique').on(table.collectionId, table.assetId),
  index('collection_assets_asset_id_idx').on(table.assetId)
])

export const dailyStorageSnapshots = pgTable('daily_storage_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  snapshotDate: text('snapshot_date').notNull(),
  highWaterMarkBytes: bigint('high_water_mark_bytes', { mode: 'number' }).notNull(),
  includedBytes: bigint('included_bytes', { mode: 'number' }).notNull(),
  overageBytes: bigint('overage_bytes', { mode: 'number' }).notNull().default(0),
  overageCostDecimillicents: bigint('overage_cost_decimillicents', { mode: 'number' }).notNull().default(0),
  ledgerEntryId: uuid('ledger_entry_id').references(() => creditLedger.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('daily_storage_snapshots_org_date_unique').on(table.organizationId, table.snapshotDate),
  index('daily_storage_snapshots_org_id_idx').on(table.organizationId)
])

export type TeamMediaAssetRow = typeof teamMediaAssets.$inferSelect
export type PendingUploadRow = typeof pendingUploads.$inferSelect
export type StorageMeteringRow = typeof storageMetering.$inferSelect
export type MediaCollectionRow = typeof mediaCollections.$inferSelect
export type CollectionAssetRow = typeof collectionAssets.$inferSelect
export type DailyStorageSnapshotRow = typeof dailyStorageSnapshots.$inferSelect
