import { sql } from 'drizzle-orm'
import type { OrganizationOnboardingData } from '@tx-agent-kit/contracts'
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex
} from 'drizzle-orm/pg-core'
import { users } from './auth.js'
import {
  invitationStatusEnum,
  memberRoleEnum,
  membershipTypeEnum,
  subscriptionStatusEnum
} from './enums.js'

type OnboardingDataPayload = OrganizationOnboardingData

export interface BrandSettingsPayload {
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
  }
  brandGuidelines: string
  industry: string
  targetAudience: string
}

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  billingEmail: text('billing_email'),
  onboardingData: jsonb('onboarding_data').$type<OnboardingDataPayload>(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePaymentMethodId: text('stripe_payment_method_id'),
  stripeMeteredSubscriptionItemId: text('stripe_metered_subscription_item_id'),
  creditsBalance: bigint('credits_balance', { mode: 'number' }).notNull().default(0),
  reservedCredits: bigint('reserved_credits', { mode: 'number' }).notNull().default(0),
  autoRechargeEnabled: boolean('auto_recharge_enabled').notNull().default(false),
  autoRechargeThreshold: bigint('auto_recharge_threshold', { mode: 'number' }),
  autoRechargeAmount: bigint('auto_recharge_amount', { mode: 'number' }),
  isSubscribed: boolean('is_subscribed').notNull().default(false),
  subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('inactive'),
  subscriptionPlan: text('subscription_plan'),
  subscriptionStartedAt: timestamp('subscription_started_at', { withTimezone: true }),
  subscriptionEndsAt: timestamp('subscription_ends_at', { withTimezone: true }),
  subscriptionCurrentPeriodEnd: timestamp('subscription_current_period_end', { withTimezone: true }),
  usageCap: bigint('usage_cap', { mode: 'number' }),
  paymentGracePeriodEndsAt: timestamp('payment_grace_period_ends_at', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  welcomeCreditGrantedAt: timestamp('welcome_credit_granted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('organizations_stripe_customer_id_unique')
    .on(table.stripeCustomerId)
    .where(sql`${table.stripeCustomerId} IS NOT NULL`),
  uniqueIndex('organizations_stripe_subscription_id_unique')
    .on(table.stripeSubscriptionId)
    .where(sql`${table.stripeSubscriptionId} IS NOT NULL`),
  index('organizations_name_id_idx').on(table.name, table.id),
  index('organizations_owner_user_id_idx').on(table.ownerUserId),
  index('organizations_suspended_at_partial_idx')
    .on(table.suspendedAt)
    .where(sql`${table.suspendedAt} IS NOT NULL`)
])

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('role_permissions_role_permission_unique').on(table.roleId, table.permissionId)
])

export const orgMembers = pgTable('org_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id),
  role: memberRoleEnum('role').notNull().default('member'),
  membershipType: membershipTypeEnum('membership_type').notNull().default('team'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('org_members_org_user_unique').on(table.organizationId, table.userId),
  index('org_members_org_id_idx').on(table.organizationId),
  index('org_members_user_id_idx').on(table.userId),
  index('org_members_user_created_at_idx').on(table.userId, table.createdAt),
  index('org_members_user_created_at_id_idx').on(table.userId, table.createdAt, table.id),
  index('org_members_org_created_at_id_idx').on(table.organizationId, table.createdAt, table.id),
  index('org_members_user_org_idx').on(table.userId, table.organizationId),
  index('org_members_role_id_idx').on(table.roleId)
])

export const userUiPreferences = pgTable('user_ui_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  preferenceKey: text('preference_key').notNull(),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('user_ui_preferences_user_org_key_unique').on(
    table.userId,
    table.organizationId,
    table.preferenceKey
  ),
  index('user_ui_preferences_org_user_idx').on(table.organizationId, table.userId)
])

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  website: text('website'),
  brandSettings: jsonb('brand_settings').$type<BrandSettingsPayload>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('teams_org_id_idx').on(table.organizationId),
  index('teams_name_id_idx').on(table.name, table.id),
  index('teams_org_name_id_idx').on(table.organizationId, table.name, table.id),
  index('teams_org_created_at_id_idx').on(table.organizationId, table.createdAt, table.id)
])

export const teamMembers = pgTable('team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id),
  role: memberRoleEnum('role').notNull().default('viewer'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId),
  index('team_members_team_id_idx').on(table.teamId),
  index('team_members_user_id_idx').on(table.userId),
  index('team_members_role_id_idx').on(table.roleId)
])

export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  role: memberRoleEnum('role').notNull().default('member'),
  status: invitationStatusEnum('status').notNull().default('pending'),
  invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  membershipType: membershipTypeEnum('membership_type').notNull().default('team'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('invitations_org_email_orgwide_pending_unique').on(table.organizationId, table.email)
    .where(sql`${table.status} = 'pending' AND ${table.teamId} IS NULL`),
  uniqueIndex('invitations_org_email_team_pending_unique').on(table.organizationId, table.email, table.teamId)
    .where(sql`${table.status} = 'pending' AND ${table.teamId} IS NOT NULL`),
  index('invitations_invitee_user_created_at_id_idx').on(
    table.inviteeUserId,
    table.createdAt,
    table.id
  ),
  index('invitations_invitee_user_expires_at_id_idx').on(
    table.inviteeUserId,
    table.expiresAt,
    table.id
  ),
  index('idx_invitations_team_id').on(table.teamId)
    .where(sql`${table.teamId} IS NOT NULL`)
])

export const contentReviewTokens = pgTable('content_review_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  permissions: text('permissions').array().notNull().default(sql`'{"view"}'`),
  reviewerName: text('reviewer_name'),
  reviewerEmail: text('reviewer_email'),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('content_review_tokens_team_id_idx').on(table.teamId),
  index('content_review_tokens_expires_at_idx')
    .on(table.expiresAt)
    .where(sql`${table.revokedAt} IS NULL`)
])

export type OrganizationRow = typeof organizations.$inferSelect
export type OrgMemberRow = typeof orgMembers.$inferSelect
export type TeamRow = typeof teams.$inferSelect
export type TeamMemberRow = typeof teamMembers.$inferSelect
export type InvitationRow = typeof invitations.$inferSelect
