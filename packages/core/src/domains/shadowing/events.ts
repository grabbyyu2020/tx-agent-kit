/**
 * Public cross-domain event contract for the shadowing domain.
 *
 * This file is the ONLY file other domains may import from this domain.
 * It exposes event type discriminants, typed payload shapes, and version constants.
 */

export type {
  ShadowingVideoImportRequestedEventPayload,
  ShadowingExplanationRegenerateRequestedEventPayload
} from './domain/shadowing-events.js'

export const shadowingEvents = {
  videoImportRequested: 'shadowing.video_import_requested',
  explanationRegenerateRequested: 'shadowing.explanation_regenerate_requested'
} as const

export const shadowingEventVersions = {
  'shadowing.video_import_requested': 1,
  'shadowing.explanation_regenerate_requested': 1
} as const
