import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import {
  campaignAnalyticsResponseSchema,
  campaignListParamsSchema,
  campaignListResponseSchema,
  campaignResponseSchema,
  campaignStepResponseSchema,
  createCampaignBodySchema,
  createStepBodySchema,
  enrollmentListResponseSchema,
  enrollmentResponseSchema,
  enrollUsersBodySchema,
  enrollUsersResponseSchema,
  resendWebhookResponseSchema,
  stepAnalyticsResponseSchema,
  stepListResponseSchema,
  unsubscribeBodySchema,
  unsubscribeResponseSchema,
  unsubscribeTokenParamsSchema,
  unsubscribeVerifyResponseSchema,
  updateCampaignBodySchema,
  updateStepBodySchema
} from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'
import { DeletedResponse } from './shared-schemas.js'

// --- Email Campaign API params (API-layer concerns) ---

const CampaignIdParam = HttpApiSchema.param('campaignId', Schema.String)
const StepIdParam = HttpApiSchema.param('stepId', Schema.String)
const EnrollmentIdParam = HttpApiSchema.param('enrollmentId', Schema.String)

// --- Email Campaign schema aliases (from contracts) ---

const CampaignResponseSchema = campaignResponseSchema
const CampaignListResponseSchema = campaignListResponseSchema
const CampaignStepResponseSchema = campaignStepResponseSchema
const StepListResponseSchema = stepListResponseSchema
const EnrollmentResponseSchema = enrollmentResponseSchema
const EnrollmentListResponseSchema = enrollmentListResponseSchema
const EnrollUsersResponseSchema = enrollUsersResponseSchema
const CampaignAnalyticsResponseSchema = campaignAnalyticsResponseSchema
const StepAnalyticsResponseSchema = stepAnalyticsResponseSchema
const CreateCampaignBody = createCampaignBodySchema
const UpdateCampaignBody = updateCampaignBodySchema
const CreateStepBody = createStepBodySchema
const UpdateStepBody = updateStepBodySchema
const EnrollUsersBody = enrollUsersBodySchema
const CampaignListParams = campaignListParamsSchema
const ResendWebhookResponseSchema = resendWebhookResponseSchema

const UnsubscribeTokenParams = unsubscribeTokenParamsSchema
const UnsubscribeVerifyResponseSchema = unsubscribeVerifyResponseSchema
const UnsubscribeBody = unsubscribeBodySchema
const UnsubscribeResponseSchema = unsubscribeResponseSchema

export const EmailCampaignsGroup = HttpApiGroup.make('emailCampaigns')
  // Campaign CRUD
  .add(
    HttpApiEndpoint.get('listCampaigns', '/v1/admin/email-campaigns')
      .setUrlParams(CampaignListParams)
      .addSuccess(CampaignListResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('createCampaign', '/v1/admin/email-campaigns')
      .setPayload(CreateCampaignBody)
      .addSuccess(CampaignResponseSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.get('getCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.patch('updateCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}`
      .setPayload(UpdateCampaignBody)
      .addSuccess(CampaignResponseSchema)
  )
  // Lifecycle
  .add(
    HttpApiEndpoint.post('activateCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/activate`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('pauseCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/pause`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('resumeCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/resume`
      .addSuccess(CampaignResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('archiveCampaign')`/v1/admin/email-campaigns/${CampaignIdParam}/archive`
      .addSuccess(CampaignResponseSchema)
  )
  // Steps
  .add(
    HttpApiEndpoint.get('listSteps')`/v1/admin/email-campaigns/${CampaignIdParam}/steps`
      .addSuccess(StepListResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('addStep')`/v1/admin/email-campaigns/${CampaignIdParam}/steps`
      .setPayload(CreateStepBody)
      .addSuccess(CampaignStepResponseSchema, { status: 201 })
  )
  .add(
    HttpApiEndpoint.patch('updateStep')`/v1/admin/email-campaigns/${CampaignIdParam}/steps/${StepIdParam}`
      .setPayload(UpdateStepBody)
      .addSuccess(CampaignStepResponseSchema)
  )
  .add(
    HttpApiEndpoint.del('removeStep')`/v1/admin/email-campaigns/${CampaignIdParam}/steps/${StepIdParam}`
      .addSuccess(DeletedResponse)
  )
  // Enrollments
  .add(
    HttpApiEndpoint.get('listEnrollments')`/v1/admin/email-campaigns/${CampaignIdParam}/enrollments`
      .addSuccess(EnrollmentListResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('enrollUsers')`/v1/admin/email-campaigns/${CampaignIdParam}/enroll`
      .setPayload(EnrollUsersBody)
      .addSuccess(EnrollUsersResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('cancelEnrollment')`/v1/admin/email-campaigns/${CampaignIdParam}/enrollments/${EnrollmentIdParam}/cancel`
      .addSuccess(EnrollmentResponseSchema)
  )
  // Analytics
  .add(
    HttpApiEndpoint.get('getCampaignAnalytics')`/v1/admin/email-campaigns/${CampaignIdParam}/analytics`
      .addSuccess(CampaignAnalyticsResponseSchema)
  )
  .add(
    HttpApiEndpoint.get('getStepAnalytics')`/v1/admin/email-campaigns/${CampaignIdParam}/steps/${StepIdParam}/analytics`
      .addSuccess(StepAnalyticsResponseSchema)
  )

export const EmailWebhooksGroup = HttpApiGroup.make('emailWebhooks')
  .add(
    HttpApiEndpoint.post('resendWebhook', '/v1/webhooks/resend')
      .addSuccess(ResendWebhookResponseSchema)
  )

export const EmailUnsubscribeGroup = HttpApiGroup.make('emailUnsubscribe')
  .add(
    HttpApiEndpoint.get('getUnsubscribe', '/v1/email/unsubscribe')
      .setUrlParams(UnsubscribeTokenParams)
      .addSuccess(UnsubscribeVerifyResponseSchema)
  )
  .add(
    HttpApiEndpoint.post('postUnsubscribe', '/v1/email/unsubscribe')
      .setPayload(UnsubscribeBody)
      .addSuccess(UnsubscribeResponseSchema)
  )
  // RFC 8058 one-click: the List-Unsubscribe header points here and mail clients
  // POST with the token in the query string (no JSON body). Reuses the verify
  // params (token) + the standard unsubscribe response.
  .add(
    HttpApiEndpoint.post('postUnsubscribeOneClick', '/v1/email/unsubscribe/one-click')
      .setUrlParams(UnsubscribeTokenParams)
      .addSuccess(UnsubscribeResponseSchema)
  )
