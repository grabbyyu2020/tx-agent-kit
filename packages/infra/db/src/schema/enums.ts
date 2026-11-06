import {
  assetCategories,
  assetTypes,
  authLoginAuditEventTypes,
  authLoginAuditStatuses,
  authLoginProviders,
  autoFixAgentKinds,
  autoFixRunStatuses,
  domainEventStatuses,
  emailCampaignStatuses,
  emailCampaignTypes,
  emailCancelReasons,
  emailEnrollmentStatuses,
  emailSendStatuses,
  emailSourceSystems,
  emailSuppressionReasons,
  invitationStatuses,
  memberRoles,
  membershipTypes,
  pendingUploadStatuses,
  processingStatuses,
  subscriptionStatuses
} from '@tx-agent-kit/contracts'
import { pgEnum } from 'drizzle-orm/pg-core'

export const memberRoleEnum = pgEnum('member_role', memberRoles)
export const invitationStatusEnum = pgEnum('invitation_status', invitationStatuses)
export const membershipTypeEnum = pgEnum('membership_type', membershipTypes)
export const subscriptionStatusEnum = pgEnum('subscription_status', subscriptionStatuses)
// auth_login_* enums/tables are strictly for first-party SaaS login/auth flows.
// They are intentionally separate from future third-party account-connection OAuth artifacts.
export const authLoginProviderEnum = pgEnum('auth_login_provider', authLoginProviders)
export const authLoginAuditStatusEnum = pgEnum('auth_login_audit_status', authLoginAuditStatuses)
export const authLoginAuditEventTypeEnum = pgEnum('auth_login_audit_event_type', authLoginAuditEventTypes)
export const domainEventStatusEnum = pgEnum('domain_event_status', domainEventStatuses)
export const assetTypeEnum = pgEnum('asset_type', assetTypes)
export const assetCategoryEnum = pgEnum('asset_category', assetCategories)
export const processingStatusEnum = pgEnum('processing_status', processingStatuses)
export const pendingUploadStatusEnum = pgEnum('pending_upload_status', pendingUploadStatuses)
export const emailCampaignTypeEnum = pgEnum('email_campaign_type', emailCampaignTypes)
export const emailCampaignStatusEnum = pgEnum('email_campaign_status', emailCampaignStatuses)
export const emailEnrollmentStatusEnum = pgEnum('email_enrollment_status', emailEnrollmentStatuses)
export const emailSendStatusEnum = pgEnum('email_send_status', emailSendStatuses)
export const emailSuppressionReasonEnum = pgEnum('email_suppression_reason', emailSuppressionReasons)
export const emailCancelReasonEnum = pgEnum('email_cancel_reason', emailCancelReasons)
export const emailSourceSystemEnum = pgEnum('email_source_system', emailSourceSystems)
export const autoFixAgentKindEnum = pgEnum('auto_fix_agent_kind', autoFixAgentKinds)
export const autoFixRunStatusEnum = pgEnum('auto_fix_run_status', autoFixRunStatuses)
