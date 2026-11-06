import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex
} from 'drizzle-orm/pg-core'
import {
  authLoginAuditEventTypeEnum,
  authLoginAuditStatusEnum,
  authLoginProviderEnum
} from './enums.js'
import type { JsonObject } from './json.js'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('users_email_ci_unique').on(sql`lower(trim(${table.email}))`)
])

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 minutes'`),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('password_reset_tokens_user_created_at_idx').on(
    table.userId,
    table.createdAt
  ),
  index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
  index('password_reset_tokens_user_expires_at_active_idx')
    .on(table.userId, table.expiresAt)
	.where(sql`${table.usedAt} IS NULL`)
])

// Active first-party login sessions for product authentication.
export const authLoginSessions = pgTable('auth_login_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authLoginProviderEnum('provider').notNull().default('password'),
  createdIp: text('created_ip'),
  createdUserAgent: text('created_user_agent'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_sessions_user_created_at_idx').on(table.userId, table.createdAt),
  index('auth_login_sessions_user_expires_at_idx').on(table.userId, table.expiresAt),
  index('auth_login_sessions_user_expires_at_active_idx')
    .on(table.userId, table.expiresAt)
	.where(sql`${table.revokedAt} IS NULL`)
])

// Refresh tokens that rotate/revoke first-party login sessions.
export const authLoginRefreshTokens = pgTable('auth_login_refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => authLoginSessions.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_refresh_tokens_session_created_at_idx').on(
    table.sessionId,
    table.createdAt
  ),
  index('auth_login_refresh_tokens_expires_at_idx').on(table.expiresAt),
  index('auth_login_refresh_tokens_session_expires_at_active_idx')
    .on(table.sessionId, table.expiresAt)
	.where(sql`${table.usedAt} IS NULL AND ${table.revokedAt} IS NULL`)
])

// OIDC state/nonce/PKCE records used only by first-party login callbacks.
export const authLoginOidcStates = pgTable('auth_login_oidc_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: authLoginProviderEnum('provider').notNull().default('google'),
  state: text('state').notNull().unique(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  requesterIp: text('requester_ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().default(sql`now() + interval '10 minutes'`),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_oidc_states_provider_expires_at_idx').on(
    table.provider,
    table.expiresAt
  ),
  index('auth_login_oidc_states_expires_at_active_idx')
    .on(table.expiresAt)
	.where(sql`${table.consumedAt} IS NULL`)
])

// External identities linked for first-party login authentication.
export const authLoginIdentities = pgTable('auth_login_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authLoginProviderEnum('provider').notNull().default('google'),
  providerSubject: text('provider_subject').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('auth_login_identities_provider_subject_unique').on(
    table.provider,
    table.providerSubject
  ),
  uniqueIndex('auth_login_identities_user_provider_unique').on(
    table.userId,
    table.provider
  ),
  index('auth_login_identities_email_ci_idx').on(sql`lower(trim(${table.email}))`)
])

// Audit trail for first-party authentication/login security events.
export const authLoginAuditEvents = pgTable('auth_login_audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  eventType: authLoginAuditEventTypeEnum('event_type').notNull(),
  status: authLoginAuditStatusEnum('status').notNull(),
  identifier: text('identifier'),
  ipAddress: text('ip_address'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('auth_login_audit_events_user_created_at_idx').on(table.userId, table.createdAt),
  index('auth_login_audit_events_event_type_created_at_idx').on(
    table.eventType,
    table.createdAt
  )
])

export type UserRow = typeof users.$inferSelect
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect
export type AuthLoginSessionRow = typeof authLoginSessions.$inferSelect
export type AuthLoginRefreshTokenRow = typeof authLoginRefreshTokens.$inferSelect
export type AuthLoginOidcStateRow = typeof authLoginOidcStates.$inferSelect
export type AuthLoginIdentityRow = typeof authLoginIdentities.$inferSelect
export type AuthLoginAuditEventRow = typeof authLoginAuditEvents.$inferSelect
