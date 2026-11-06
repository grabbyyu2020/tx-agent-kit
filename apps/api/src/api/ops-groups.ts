import { HttpApiEndpoint, HttpApiGroup } from '@effect/platform'
import {
  sentryWebhookResponseSchema,
  healthResponseSchema
} from '@tx-agent-kit/contracts'

const HealthResponse = healthResponseSchema

const SentryWebhookResponseSchema = sentryWebhookResponseSchema

export const HealthGroup = HttpApiGroup.make('health')
  .add(HttpApiEndpoint.get('health', '/health').addSuccess(HealthResponse))

export const SentryWebhooksGroup = HttpApiGroup.make('sentryWebhooks')
  .add(
    HttpApiEndpoint.post('sentryNewIssueWebhook', '/internal/sentry/new-issue')
      .addSuccess(SentryWebhookResponseSchema)
  )
