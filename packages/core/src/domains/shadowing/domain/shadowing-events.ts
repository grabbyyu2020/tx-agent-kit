export interface ShadowingVideoImportRequestedEventPayload {
  readonly videoId: string
  readonly userId: string
}

export interface ShadowingExplanationRegenerateRequestedEventPayload {
  readonly videoId: string
  readonly sentenceId: string
}
