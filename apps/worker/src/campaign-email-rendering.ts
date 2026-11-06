import { getEmailEnv, renderEmailTemplate, type LifecycleEmailProps } from '@tx-agent-kit/email'
import { resolveLifecycleCtaUrl } from './activities/cta-url.js'
import { logger } from './activities/shared.js'

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

const renderFallback = (
  templateId: string,
  data: Record<string, unknown>,
  userName: string
): { html: string; text: string } => {
  const safeUserName = userName.replaceAll(/[\r\n]/g, '')
  const body = typeof data.body === 'string' ? data.body : ''

  const html = [
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">`,
    body
      ? `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">${escapeHtml(body)}</p>`
      : `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">Hello ${escapeHtml(safeUserName)},</p>`,
    `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />`,
    `<p style="margin: 0; color: #9ca3af; font-size: 12px;">Template: ${escapeHtml(templateId)}</p>`,
    `</div>`
  ].join('')

  const text = body || `Hello ${safeUserName},\n\nTemplate: ${templateId}`

  return { html, text }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#x27;')
}

const DEFAULT_WEB_BASE_URL = 'http://localhost:3000'

/**
 * Build the lifecycle render context (portable app-surface CTA URL + known
 * per-step values) and render via the real React Email registry. Falls back to
 * the minimal stub only for an unknown templateId (which should essentially
 * never happen - config templateIds are compile-checked against the registry).
 *
 * The starter kit's lifecycle emails are not team-scoped: every step's
 * `ctaSurface` resolves to an app-level SPA route (see resolveLifecycleCtaUrl).
 */
export const renderEmailContent = async (
  templateId: string,
  templateData: Record<string, unknown>,
  userName: string
): Promise<{ html: string; text: string }> => {
  const baseUrl = getEmailEnv().WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL
  const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
  const ctaUrl = resolveLifecycleCtaUrl({
    ctaSurface: templateData.ctaSurface,
    ctaUrl: asString(templateData.ctaUrl),
    baseUrl
  })
  const props: LifecycleEmailProps = {
    userName,
    ctaUrl,
    appUrl: `${baseUrl.replace(/\/+$/, '')}/dashboard`,
    creditBalanceUsd: asString(templateData.creditBalanceUsd)
  }
  const rendered = await renderEmailTemplate(templateId, props)
  if (rendered !== null) {
    return rendered
  }
  logger.warn('Unknown email templateId; using minimal fallback.', { templateId })
  return renderFallback(templateId, templateData, userName)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const toJsonRecord = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}
