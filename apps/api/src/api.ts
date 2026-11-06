import { HttpApi } from '@effect/platform'
import {
  BadRequest,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  PaymentRequired,
  TooManyRequests,
  Unauthorized
} from './api/errors.js'
import { BillingGroup, StorageMeteringGroup } from './api/billing-groups.js'
import { EmailCampaignsGroup, EmailUnsubscribeGroup, EmailWebhooksGroup } from './api/email-groups.js'
import { AuthGroup, OrganizationsGroup, PermissionsGroup, RolesGroup, TeamsGroup } from './api/identity-groups.js'
import { AssetsGroup, StorageGroup } from './api/media-groups.js'
import { HealthGroup, SentryWebhooksGroup } from './api/ops-groups.js'
import { ShadowingGroup } from './api/shadowing-group.js'

// The HttpApi definition is split by concern into ./api/*.ts (error types and
// CoreError mapping, then endpoint groups); this file re-exports them so
// `./api.js` stays the single entry point. Group registration order below
// determines OpenAPI output and route matching order.
export {
  BadRequest,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  PaymentRequired,
  TooManyRequests,
  Unauthorized,
  mapCoreError,
  mapRequestBodyError
} from './api/errors.js'
export {
  AssetsGroup,
  AuthGroup,
  BillingGroup,
  EmailCampaignsGroup,
  EmailUnsubscribeGroup,
  EmailWebhooksGroup,
  HealthGroup,
  OrganizationsGroup,
  PermissionsGroup,
  RolesGroup,
  SentryWebhooksGroup,
  ShadowingGroup,
  StorageGroup,
  StorageMeteringGroup,
  TeamsGroup
}

export class TxAgentApi extends HttpApi.make('tx-agent-kit')
  .addError(BadRequest, { status: 400 })
  .addError(Unauthorized, { status: 401 })
  .addError(PaymentRequired, { status: 402 })
  .addError(Forbidden, { status: 403 })
  .addError(NotFound, { status: 404 })
  .addError(Conflict, { status: 409 })
  .addError(TooManyRequests, { status: 429 })
  .addError(InternalError, { status: 500 })
  .add(HealthGroup)
  .add(AuthGroup)
  .add(OrganizationsGroup)
  .add(TeamsGroup)
  .add(BillingGroup)
  .add(PermissionsGroup)
  .add(StorageGroup)
  .add(RolesGroup)
  .add(AssetsGroup)
  .add(StorageMeteringGroup)
  .add(EmailCampaignsGroup)
  .add(EmailWebhooksGroup)
  .add(SentryWebhooksGroup)
  .add(EmailUnsubscribeGroup)
  .add(ShadowingGroup) {}
