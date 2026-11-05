---
kind: spec
spec_type: design
doc_id: doc-987f75b37196
name: youtube-shadowing-design
title: "YouTube Shadowing Practice"
status: draft
version: 1
owners:
  - test-olim
summary: "User-scoped shadowing domain: yt-dlp captions, LLM sentence segmentation, deterministic practice segments, batched Chinese explanations in a Temporal workflow, and an embedded YouTube practice page."
domain: shadowing
tags:
  - design
  - youtube
  - shadowing
  - ai
  - temporal
depends_on:
  - temporal-workflows-design
  - ai-generation-design
supersedes: []
implements: youtube-shadowing-prd
last_reviewed_at: 2026-11-05
plan: "~/.claude/plans/youtube-shadowing.md"
---

# Plan

> Full plan: `~/.claude/plans/youtube-shadowing.md`
> tx plan doc: [youtube-shadowing-plan](../plan/youtube-shadowing-plan.md)

The plan records 18 decisions from the 2026-11-05 grilling session: a personal, locally run tool
inside tx-agent-kit; English captions downloaded with yt-dlp and re-segmented into sentences by an
LLM; long sentences split deterministically with `compromise`; sentence-by-sentence practice on the
embedded YouTube player with manual advance; and Chinese explanations (meaning, key expressions,
tone and context) generated in background batches with the full transcript as context.

# Summary

A new `shadowing` domain stores videos, sentences, practice segments and explanations per user.
`POST /v1/shadowing/videos` inserts the video and a `shadowing.video_import_requested` event in one
transaction; the outbox dispatcher starts `shadowingImportWorkflow`, which downloads captions with
yt-dlp, asks the LLM for sentence boundaries, checks that the sentences reproduce the caption words,
derives timings, splits long sentences with `compromise`, then explains sentences in batches of 20.
Batch selection is read from the database on every loop iteration, so the API prioritises a batch
by writing a timestamp instead of signalling Temporal. Regeneration goes through a second outbox
event and a small workflow. The web app adds a library page and a practice page that drives the
YouTube IFrame player and pauses 200 ms after each segment end.

# Architecture

## System Context

The feature follows the layering in `docs/ARCHITECTURE.md`: contracts in `packages/contracts`,
domain logic in `packages/core/src/domains/shadowing`, persistence in `packages/infra/db`, HTTP in
`apps/api`, background work in `apps/worker`, UI in `apps/web`. The API never imports Temporal; all
background work starts from the transactional outbox and `apps/worker/src/dispatch/resolve-dispatch.ts`.
Data is owned by `users.id` only (no organization or team). The existing OpenRouter module is left
untouched; a separate OpenAI-compatible client is added to `packages/infra/ai`.

## Component Diagram

```
┌──────────────────────────── apps/web [MOD] ─────────────────────────────┐
│ app/(application)/shadowing/page.tsx [NEW]          library               │
│ app/(application)/shadowing/[videoId]/page.tsx [NEW] practice             │
│ components/shadowing/* [NEW]  useYouTubeSegmentPlayer, ExplanationPanel, │
│                               SentenceList, useShadowingShortcuts        │
│ lib/api/generated/shadowing/* [NEW, Orval]                                │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTP (Bearer)
┌───────────────────────────────▼──────────── apps/api [MOD] ──────────────┐
│ api.ts: ShadowingGroup [NEW]   routes/shadowing.ts [NEW] (requireAuth)    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ ShadowingService
┌───────────────────────────────▼─── packages/core/domains/shadowing [NEW] ┐
│ events.ts         shadowingEvents / shadowingEventVersions               │
│ domain/           youtube-url, caption-transcript, sentence-alignment,    │
│                   practice-segments, explanation, prompts, events        │
│ ports/            ShadowingStorePort, CaptionSourcePort, ShadowingLlmPort │
│ application/      ShadowingService (API), ShadowingImportService (worker)│
│ adapters/         store (db), yt-dlp caption source, llm (infra/ai)       │
└──────────┬───────────────────────────┬───────────────────────────┬───────┘
           │                           │                           │
┌──────────▼─────────┐   ┌─────────────▼────────────┐   ┌──────────▼───────────┐
│ packages/infra/db  │   │ packages/infra/ai [MOD]  │   │ yt-dlp (execFile)    │
│ [MOD] 3 tables,    │   │ openai-compatible.ts     │   │ external binary      │
│ repo, migration    │   │ [NEW] + env getters      │   └──────────────────────┘
└──────────▲─────────┘   └──────────────────────────┘
           │ domain_events (outbox)
┌──────────┴──────────────────────────────── apps/worker [MOD] ────────────┐
│ dispatch/resolve-dispatch.ts [MOD]  2 new cases                           │
│ workflows.ts [MOD]  shadowingImportWorkflow, shadowingRegenerateWorkflow  │
│ shadowing-activities.ts [NEW]  merged into combinedActivities            │
│ config/env.ts [MOD]  YT_DLP_PATH                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Component Inventory

| Component | Package/App | Responsibility | New/Modified |
|-----------|-------------|----------------|--------------|
| Literals + constants | `packages/contracts/src/literals.ts`, `constants.ts` | Statuses, failure reasons, event types, `shadowing` aggregate, segment and batch limits | Modified |
| API schemas | `packages/contracts/src/shadowing.ts` | Request/response Effect schemas | New |
| Event payload schemas | `packages/temporal-client/src/types/domain-event.ts` | `ShadowingVideoImportRequestedEventPayloadSchema`, `ShadowingExplanationRegenerateRequestedEventPayloadSchema` | Modified |
| Pure domain | `packages/core/src/domains/shadowing/domain/*` | URL parsing, json3 parsing, sentence alignment, segment splitting, explanation schema, prompts | New |
| Ports | `packages/core/src/domains/shadowing/ports/shadowing-ports.ts` | Store, caption source, LLM capabilities | New |
| Services | `packages/core/src/domains/shadowing/application/*` | API use cases and worker import use cases | New |
| Adapters | `packages/core/src/domains/shadowing/adapters/*` | Drizzle store, yt-dlp caption source, LLM adapter | New |
| Row mappers | `packages/core/src/adapters/shadowing-row-mappers.ts` | DB rows → domain records (re-exported by `db-row-mappers.ts`) | New |
| Tables + repo | `packages/infra/db/src/schema.ts`, `repositories/shadowing.ts`, `effect-schemas/shadowing-*.ts`, `factories/shadowing-*.factory.ts` | Persistence, outbox writes in transaction | New/Modified |
| Migration | `packages/infra/db/drizzle/migrations/0057_shadowing.sql` | Tables, indexes, constraints | New |
| LLM client | `packages/infra/ai/src/openai-compatible.ts`, `env.ts` | Fetch-based JSON chat completions with usage and spans | New/Modified |
| API group | `apps/api/src/api.ts`, `apps/api/src/routes/shadowing.ts`, `server-lib.ts` | Endpoints, auth, error mapping, layer wiring | New/Modified |
| Dispatch | `apps/worker/src/dispatch/resolve-dispatch.ts` | Event → workflow start plans | Modified |
| Workflows | `apps/worker/src/workflows.ts` | Import and regenerate workflows | Modified |
| Activities | `apps/worker/src/shadowing-activities.ts`, `activities.ts` | Run domain services from Temporal | New/Modified |
| Worker env | `apps/worker/src/config/env.ts` | `YT_DLP_PATH` (default `yt-dlp`) | Modified |
| Web pages | `apps/web/app/(application)/shadowing/**` | Library and practice UI | New |
| Web components | `apps/web/components/shadowing/*` | Player hook, explanation panel, sentence list, shortcuts | New |
| Navigation | `apps/web/components/AppShell.tsx` | "Shadowing" entry | Modified |
| Orb setup | `.agents/setup` | Install yt-dlp for local runs in orbs | Modified |

## Design Decisions

### Decision 1: Prioritise batches through the database, not Temporal signals

**Context:** REQ-SHADOW-014 needs the learner's current batch generated next. The repo has no
workflow signals, and `apps/api` may only import `@temporalio/client` in
`apps/api/src/adapters/temporal-control.ts`, which exists for a different queue.

| Option | Pros | Cons |
|--------|------|------|
| Signal `prioritizeBatch` from the API | Immediate | Adds a second sanctioned Temporal adapter in the API and the repo's first signal handler |
| Outbox event per prioritisation | Follows the outbox rule | Needs signals anyway to reach the running workflow |
| Write `explanation_requested_at` on the batch's sentences; the workflow asks the DB for the next batch each iteration | No Temporal in the API, no signals, deterministic workflow (the choice happens inside an activity), survives workflow restarts | Prioritised batch starts after the batch in flight finishes (≤ one batch of latency) |

**Decision:** database-driven selection. The `nextShadowingExplanationBatch` activity returns the
batch of the pending sentence with the latest `explanation_requested_at`, else the lowest pending
`batch_index`.
**Consequences:** the API stays Temporal-free; at most one batch (~20 sentences) delays a
prioritised batch; batch order is visible in SQL for debugging.

### Decision 2: The LLM proposes sentence boundaries; code owns words and timings

**Context:** captions must keep their wording (REQ-SHADOW-005) and timings must come from captions
(REQ-SHADOW-004).

| Option | Pros | Cons |
|--------|------|------|
| Store the LLM's sentence text | Simple | LLM can paraphrase or drop words; timings lost |
| LLM returns sentences; `alignSentences` maps them back onto caption words and rejects any mismatch | Wording guaranteed, timings exact, malformed output detected | Needs a normaliser and retry on mismatch |

**Decision:** alignment. Sentence text is rebuilt from caption words with the LLM's punctuation
and capitalisation applied token by token; a token mismatch after normalisation fails the attempt.

### Decision 3: One activity fetches captions and segments the transcript

**Context:** raw captions must not be persisted (NFR-041) and Temporal payloads are limited to 2 MB.

**Decision:** `prepareShadowingTranscript` downloads captions to a temp dir, parses them in memory,
segments, stores sentences and segments, deletes the temp dir, and returns only counts. Its retry
policy covers yt-dlp and LLM transient errors together.

### Decision 4: Progress lives on the video row; subtitle preference lives in the browser

**Context:** one learner per video row (unique per user and YouTube id).

**Decision:** `shadowing_videos.last_segment_index` stores resume position; the subtitle toggle is
stored in `localStorage` key `shadowing.subtitleVisible` (REQ-SHADOW-024 asks only that the choice
be remembered). No progress table.

### Decision 5: Regeneration uses its own outbox event and workflow

**Decision:** `POST .../regenerate` sets the sentence to `regenerating` and writes
`shadowing.explanation_regenerate_requested`; `shadowingRegenerateWorkflow` explains that one
sentence with the same transcript prefix. The import workflow only selects `pending` sentences, so
the two workflows never write the same sentence.

# Interfaces

```yaml
interfaces:
  - name: shadowing.importVideo
    type: http
    method: POST
    path: /v1/shadowing/videos
    semantics: "Requires auth. Parses the YouTube URL; returns the caller's existing video for the same YouTube id, otherwise inserts a video in status importing plus a shadowing.video_import_requested outbox event in one transaction. 400 on an unrecognised URL with no row written."
    contract: "ImportShadowingVideoBody { url } -> ImportShadowingVideoResponse { video: ShadowingVideoSummary, created: boolean } (packages/contracts/src/shadowing.ts)"
  - name: shadowing.listVideos
    type: http
    method: GET
    path: /v1/shadowing/videos
    semantics: "Requires auth. Lists the caller's videos newest first with status, failure reason, sentence count and explained count."
    contract: "-> ShadowingVideoListResponse { data: ShadowingVideoSummary[] }"
  - name: shadowing.getVideo
    type: http
    method: GET
    path: /v1/shadowing/videos/{videoId}
    semantics: "Requires auth. Returns the video with all sentences (including stored explanations and their status) and segments ordered by index. 404 when the video does not exist or belongs to another user. Never calls the LLM."
    contract: "-> ShadowingVideoDetail { video, sentences: ShadowingSentence[], segments: ShadowingSegment[] }"
  - name: shadowing.deleteVideo
    type: http
    method: DELETE
    path: /v1/shadowing/videos/{videoId}
    semantics: "Requires auth. Deletes the video; sentences and segments cascade. 404 for missing or foreign videos."
    contract: "-> 204"
  - name: shadowing.retryImport
    type: http
    method: POST
    path: /v1/shadowing/videos/{videoId}/retry
    semantics: "Requires auth. Only for status failed (409 otherwise). Resets status to importing, clears failure fields, writes a new import event."
    contract: "-> 202 ShadowingVideoSummary"
  - name: shadowing.saveProgress
    type: http
    method: PUT
    path: /v1/shadowing/videos/{videoId}/progress
    semantics: "Requires auth. Stores last_segment_index; 400 when the index is outside the video's segments."
    contract: "SaveShadowingProgressBody { segmentIndex } -> 204"
  - name: shadowing.prioritizeSentence
    type: http
    method: POST
    path: /v1/shadowing/videos/{videoId}/sentences/{sentenceIndex}/prioritize
    semantics: "Requires auth. Sets explanation_requested_at = now() on the pending sentences of that sentence's batch. No-op when nothing is pending."
    contract: "-> 204"
  - name: shadowing.regenerateExplanation
    type: http
    method: POST
    path: /v1/shadowing/videos/{videoId}/sentences/{sentenceIndex}/regenerate
    semantics: "Requires auth. Allowed when explanation_status is ready or failed (409 for pending or regenerating). Sets regenerating and writes shadowing.explanation_regenerate_requested in one transaction."
    contract: "-> 202 ShadowingSentence"
  - name: shadowing.video_import_requested
    type: event
    semantics: "Outbox event, aggregate shadowing, aggregateId = videoId. Dispatched to shadowingImportWorkflow with workflowId shadowing-import-${event.id}."
    contract: "ShadowingVideoImportRequestedEventPayloadSchema { videoId: UUID, userId: UUID }"
  - name: shadowing.explanation_regenerate_requested
    type: event
    semantics: "Outbox event, aggregate shadowing, aggregateId = videoId. Dispatched to shadowingRegenerateWorkflow with workflowId shadowing-regenerate-${event.id}."
    contract: "ShadowingExplanationRegenerateRequestedEventPayloadSchema { videoId: UUID, sentenceId: UUID }"
  - name: llm.chatCompletions
    type: rpc
    method: POST
    path: "${SHADOWING_LLM_BASE_URL}/chat/completions"
    semantics: "OpenAI-compatible chat completions with response_format json_object, Bearer SHADOWING_LLM_API_KEY, model SHADOWING_LLM_MODEL, used for both segmentation and explanation."
    contract: "chatCompletionsJson(request) in packages/infra/ai/src/openai-compatible.ts"
  - name: yt-dlp
    type: rpc
    semantics: "execFile(YT_DLP_PATH, args) without a shell; only called with a validated 11-character video id. Two calls: --dump-single-json --skip-download for metadata, then --skip-download --write-subs|--write-auto-subs --sub-langs <lang> --sub-format json3 into a temp dir."
    contract: "CaptionSourcePort.fetchVideoSource(youtubeVideoId)"
```

## API Endpoints

| Method | Path | Request Schema | Response Schema | Auth | Permission |
|--------|------|----------------|-----------------|------|-----------|
| POST | `/v1/shadowing/videos` | `ImportShadowingVideoBody` | `ImportShadowingVideoResponse` (200) | Bearer | owner = caller |
| GET | `/v1/shadowing/videos` | – | `ShadowingVideoListResponse` | Bearer | own rows only |
| GET | `/v1/shadowing/videos/{videoId}` | – | `ShadowingVideoDetail` | Bearer | owner |
| DELETE | `/v1/shadowing/videos/{videoId}` | – | 204 | Bearer | owner |
| POST | `/v1/shadowing/videos/{videoId}/retry` | – | `ShadowingVideoSummary` (202) | Bearer | owner |
| PUT | `/v1/shadowing/videos/{videoId}/progress` | `SaveShadowingProgressBody` | 204 | Bearer | owner |
| POST | `/v1/shadowing/videos/{videoId}/sentences/{sentenceIndex}/prioritize` | – | 204 | Bearer | owner |
| POST | `/v1/shadowing/videos/{videoId}/sentences/{sentenceIndex}/regenerate` | – | `ShadowingSentence` (202) | Bearer | owner |

### Request/Response Schemas

```typescript
// packages/contracts/src/shadowing.ts
import { Schema } from 'effect'
import {
  shadowingCaptionKinds, shadowingExplanationStatuses,
  shadowingFailureReasons, shadowingVideoStatuses
} from './literals.js'

export const importShadowingVideoBodySchema = Schema.Struct({ url: Schema.String.pipe(Schema.maxLength(2048)) })

export const shadowingVideoSummarySchema = Schema.Struct({
  id: Schema.UUID,
  youtubeVideoId: Schema.String,
  title: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(Schema.Int),
  captionKind: Schema.NullOr(Schema.Literal(...shadowingCaptionKinds)),
  status: Schema.Literal(...shadowingVideoStatuses),
  failureReason: Schema.NullOr(Schema.Literal(...shadowingFailureReasons)),
  failureMessage: Schema.NullOr(Schema.String),
  sentenceCount: Schema.Int,
  explainedCount: Schema.Int,
  lastSegmentIndex: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const importShadowingVideoResponseSchema = Schema.Struct({
  video: shadowingVideoSummarySchema,
  created: Schema.Boolean
})

export const shadowingKeyExpressionSchema = Schema.Struct({
  expression: Schema.String,   // English, verbatim from the sentence
  explanation: Schema.String   // Chinese
})

export const shadowingExplanationSchema = Schema.Struct({
  meaning: Schema.String,                       // Chinese paraphrase of the whole sentence
  keyExpressions: Schema.Array(shadowingKeyExpressionSchema),
  toneAndContext: Schema.String                 // Chinese
})

export const shadowingSentenceSchema = Schema.Struct({
  id: Schema.UUID,
  sentenceIndex: Schema.Int,
  batchIndex: Schema.Int,
  text: Schema.String,
  startMs: Schema.Int,
  endMs: Schema.Int,
  explanationStatus: Schema.Literal(...shadowingExplanationStatuses),
  explanation: Schema.NullOr(shadowingExplanationSchema)
})

export const shadowingSegmentSchema = Schema.Struct({
  segmentIndex: Schema.Int,
  sentenceIndex: Schema.Int,
  text: Schema.String,
  startMs: Schema.Int,
  endMs: Schema.Int
})

export const shadowingVideoDetailSchema = Schema.Struct({
  video: shadowingVideoSummarySchema,
  sentences: Schema.Array(shadowingSentenceSchema),
  segments: Schema.Array(shadowingSegmentSchema)
})

export const saveShadowingProgressBodySchema = Schema.Struct({ segmentIndex: Schema.Int.pipe(Schema.nonNegative()) })
```

```typescript
// packages/contracts/src/literals.ts (additions)
export const shadowingVideoStatuses = ['importing', 'explaining', 'ready', 'failed'] as const
export const shadowingFailureReasons = ['no_captions', 'not_embeddable', 'import_error'] as const
export const shadowingExplanationStatuses = ['pending', 'ready', 'failed', 'regenerating'] as const
export const shadowingCaptionKinds = ['manual', 'auto'] as const
// domainEventTypes += 'shadowing.video_import_requested', 'shadowing.explanation_regenerate_requested'
// domainEventAggregateTypes += 'shadowing'

// packages/contracts/src/constants.ts (additions)
export const SHADOWING_SEGMENT_MAX_WORDS = 25
export const SHADOWING_SEGMENT_MAX_MS = 8_000
export const SHADOWING_EXPLANATION_BATCH_SIZE = 20
export const SHADOWING_EXPLANATION_MAX_ATTEMPTS = 3
export const SHADOWING_PAUSE_PADDING_MS = 200
export const SHADOWING_SEGMENTATION_CHUNK_WORDS = 1_500
```

### Error Responses

| Status | Error Code | Condition | Response Body |
|--------|-----------|-----------|---------------|
| 400 | `BAD_REQUEST` | URL is not a YouTube watch/short/embed/youtu.be URL with an 11-character id; progress index out of range | `{ error, details }` |
| 401 | `UNAUTHORIZED` | Missing or expired token | `{ error }` |
| 404 | `NOT_FOUND` | Video or sentence missing, or owned by another user | `{ error }` |
| 409 | `CONFLICT` | Retry on a video not in `failed`; regenerate on a sentence in `pending` or `regenerating` | `{ error, details }` |

## Port Contracts

```typescript
// packages/core/src/domains/shadowing/ports/shadowing-ports.ts
export const ShadowingRepositoryKind = 'custom' as const

export class ShadowingStorePort extends Context.Tag('ShadowingStorePort')<ShadowingStorePort, {
  findVideoForUser: (userId: string, videoId: string) => Effect.Effect<Option.Option<ShadowingVideoRecord>, unknown>
  findVideoByYoutubeId: (userId: string, youtubeVideoId: string) => Effect.Effect<Option.Option<ShadowingVideoRecord>, unknown>
  insertVideoWithImportEvent: (input: InsertShadowingVideoCommand) => Effect.Effect<ShadowingVideoRecord, unknown>
  listVideosForUser: (userId: string) => Effect.Effect<readonly ShadowingVideoRecord[], unknown>
  getVideoDetail: (videoId: string) => Effect.Effect<ShadowingVideoDetailRecord, unknown>
  deleteVideo: (videoId: string) => Effect.Effect<void, unknown>
  resetVideoForRetry: (videoId: string) => Effect.Effect<ShadowingVideoRecord, unknown>          // + outbox event
  saveProgress: (videoId: string, segmentIndex: number) => Effect.Effect<void, unknown>
  prioritizeBatchOfSentence: (videoId: string, sentenceIndex: number) => Effect.Effect<void, unknown>
  markSentenceRegenerating: (videoId: string, sentenceIndex: number) => Effect.Effect<Option.Option<ShadowingSentenceRecord>, unknown> // + outbox event, only from ready|failed
  // worker side
  updateVideoMetadata: (videoId: string, metadata: ShadowingVideoMetadata) => Effect.Effect<void, unknown>
  replaceTranscript: (videoId: string, sentences: readonly NewShadowingSentence[], segments: readonly NewShadowingSegment[]) => Effect.Effect<void, unknown> // delete + insert in one transaction
  setVideoStatus: (videoId: string, status: ShadowingVideoStatus, failure?: { reason: ShadowingFailureReason; message: string }) => Effect.Effect<void, unknown>
  nextPendingBatchIndex: (videoId: string) => Effect.Effect<Option.Option<number>, unknown>
  listSentences: (videoId: string) => Effect.Effect<readonly ShadowingSentenceRecord[], unknown>
  storeExplanations: (videoId: string, batchIndex: number, explanations: ReadonlyMap<number, ShadowingExplanation>) => Effect.Effect<void, unknown> // only rows still pending
  markBatchFailed: (videoId: string, batchIndex: number) => Effect.Effect<void, unknown>
  finishRegeneration: (sentenceId: string, result: Either.Either<ShadowingExplanation, string>) => Effect.Effect<void, unknown>
}>() {}

export class CaptionSourcePort extends Context.Tag('CaptionSourcePort')<CaptionSourcePort, {
  fetchVideoSource: (youtubeVideoId: YoutubeVideoId) => Effect.Effect<
    ShadowingVideoSource,                         // metadata + parsed caption words
    NoCaptionsError | NotEmbeddableError | CaptionSourceError
  >
}>() {}

export class ShadowingLlmPort extends Context.Tag('ShadowingLlmPort')<ShadowingLlmPort, {
  segmentSentences: (input: { title: string; words: readonly string[] }) => Effect.Effect<readonly string[], LlmCallError>
  explainSentences: (input: ExplainBatchInput) => Effect.Effect<ReadonlyMap<number, ShadowingExplanation>, LlmCallError>
}>() {}
```

Domain errors (`NoCaptionsError`, `NotEmbeddableError`, `CaptionSourceError`, `LlmCallError`,
`LlmNotConfiguredError`, `SentenceAlignmentError`) are `Data.TaggedError`s private to the domain. Every
`LlmCallError`, `CaptionSourceError`, `SentenceAlignmentError` and store error is treated as
retryable; `NoCaptionsError`, `NotEmbeddableError` and `LlmNotConfiguredError` are not
(`classifyShadowingImportError`). The video detail type is `ShadowingVideoDetailAggregate`
because `*Record` types must map to one table.
`ShadowingService` maps them to `CoreError` (`badRequest`, `notFound`, `conflict`, `internalError`);
`ShadowingImportService` maps them to a `ShadowingImportOutcome` that the activity turns into either
a retryable failure or `ApplicationFailure.nonRetryable` with the failure reason.

## Event Payloads

```typescript
// packages/core/src/domains/shadowing/domain/shadowing-events.ts
export interface ShadowingVideoImportRequestedEventPayload { videoId: string; userId: string }
export interface ShadowingExplanationRegenerateRequestedEventPayload { videoId: string; sentenceId: string }

// packages/core/src/domains/shadowing/events.ts
export type { ShadowingVideoImportRequestedEventPayload, ShadowingExplanationRegenerateRequestedEventPayload } from './domain/shadowing-events.js'
export const shadowingEvents = {
  videoImportRequested: 'shadowing.video_import_requested',
  explanationRegenerateRequested: 'shadowing.explanation_regenerate_requested'
} as const
export const shadowingEventVersions = {
  'shadowing.video_import_requested': 1,
  'shadowing.explanation_regenerate_requested': 1
} as const

// packages/temporal-client/src/types/domain-event.ts
export const ShadowingVideoImportRequestedEventPayloadSchema = Schema.Struct({ videoId: Schema.UUID, userId: Schema.UUID })
export const ShadowingExplanationRegenerateRequestedEventPayloadSchema = Schema.Struct({ videoId: Schema.UUID, sentenceId: Schema.UUID })
```

## Pure Domain Functions

| Function | File | Contract |
|----------|------|----------|
| `parseYoutubeVideoId(url)` | `domain/youtube-url.ts` | Accepts `youtube.com/watch?v=`, `m.youtube.com`, `youtube.com/shorts/`, `youtube.com/embed/`, `youtu.be/`; returns `Option<YoutubeVideoId>` matching `^[A-Za-z0-9_-]{11}$` |
| `selectCaptionTrack(info)` | `domain/caption-transcript.ts` | From yt-dlp JSON: first `subtitles` key equal to `en` or starting with `en-` (manual); else `automatic_captions` `en-orig`, then `en`; else `None` |
| `parseJson3Captions(json)` | `domain/caption-transcript.ts` | Returns `CaptionWord[] { text, startMs, endMs }`; word-level offsets (`tOffsetMs`) when present, otherwise cue time split across words proportionally to character length; drops `aAppend` newline events and empty segs; collapses a word repeated at the same timestamp |
| `normaliseToken(s)` | `domain/sentence-alignment.ts` | Lower-case, strip punctuation except inner apostrophes, NFKC |
| `alignSentences(words, sentences)` | `domain/sentence-alignment.ts` | `Either<SentenceAlignmentError, AlignedSentence[]>`; the normalised token stream of `sentences` must equal the caption tokens exactly; each sentence gets `startMs` of its first word, `endMs` of its last word, and text built from the LLM tokens |
| `splitIntoPracticeSegments(sentence, limits, clauseSplitter)` | `domain/practice-segments.ts` | Returns ≥ 1 segments covering the sentence's words in order with no overlap; uses `compromise` clauses packed greedily within `SHADOWING_SEGMENT_MAX_WORDS` and `SHADOWING_SEGMENT_MAX_MS`; a part still over the limit splits at the largest gap between consecutive word timings (> 0 ms), recursively; with no positive gap it stays whole |
| `batchIndexOf(sentenceIndex)` | `domain/explanation.ts` | `Math.floor(sentenceIndex / SHADOWING_EXPLANATION_BATCH_SIZE)` |
| `buildExplanationMessages(input)` | `domain/prompts.ts` | `[system, user(transcript prefix), user(task)]`; the system and transcript messages depend only on the title and the numbered sentence list, so they are byte-identical across batches of one video |
| `decodeExplanationBatch(json, expectedIndexes)` | `domain/explanation.ts` | Strict hand-written validation (the core lint allows only `Either`/`Option`/`Data`/`Match`/`pipe` in `domain/`, so no Effect Schema) of `{ explanations: [{ sentenceIndex, meaning, keyExpressions, toneAndContext }] }`; fails unless the index set equals `expectedIndexes` exactly |

### Prompts

System prompt (explanation), fixed text in `domain/prompts.ts`: the learner is a native Chinese
speaker; explain each requested sentence in Chinese with exactly three fields (`meaning`,
`keyExpressions`, `toneAndContext`); quote English expressions verbatim in English; no grammar
analysis, example sentences or pronunciation; reply with JSON only. The transcript message is
`Title: <title>\n\n[0] <sentence>\n[1] <sentence>...`. The task message is
`Explain sentences <i>..<j>` with the index list. Segmentation uses its own system prompt: split the
given caption words into complete sentences, add punctuation and capitalisation only, do not add,
remove, reorder or change words, return `{ "sentences": string[] }`.

# Data Model

## New Tables

```sql
-- packages/infra/db/drizzle/migrations/0057_shadowing.sql
CREATE TABLE shadowing_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL CHECK (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  caption_kind TEXT CHECK (caption_kind IN ('manual', 'auto')),
  status TEXT NOT NULL DEFAULT 'importing' CHECK (status IN ('importing', 'explaining', 'ready', 'failed')),
  failure_reason TEXT CHECK (failure_reason IN ('no_captions', 'not_embeddable', 'import_error')),
  failure_message TEXT,
  sentence_count INTEGER NOT NULL DEFAULT 0,
  last_segment_index INTEGER NOT NULL DEFAULT 0 CHECK (last_segment_index >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'failed') = (failure_reason IS NOT NULL))
);
CREATE UNIQUE INDEX shadowing_videos_user_youtube_unique ON shadowing_videos(user_id, youtube_video_id);
CREATE INDEX shadowing_videos_user_created_idx ON shadowing_videos(user_id, created_at DESC);

CREATE TABLE shadowing_sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES shadowing_videos(id) ON DELETE CASCADE,
  sentence_index INTEGER NOT NULL CHECK (sentence_index >= 0),
  batch_index INTEGER NOT NULL CHECK (batch_index >= 0),
  text TEXT NOT NULL,
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms >= start_ms),
  explanation JSONB,
  explanation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (explanation_status IN ('pending', 'ready', 'failed', 'regenerating')),
  explanation_requested_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shadowing_sentences_explanation_consistency CHECK (
    (explanation_status <> 'ready' OR explanation IS NOT NULL)
    AND (explanation_status <> 'pending' OR explanation IS NULL)
  )  -- failed and regenerating may keep the previous explanation
);
CREATE UNIQUE INDEX shadowing_sentences_video_index_unique ON shadowing_sentences(video_id, sentence_index);
CREATE INDEX shadowing_sentences_pending_idx ON shadowing_sentences(video_id, explanation_status, batch_index);

CREATE TABLE shadowing_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES shadowing_videos(id) ON DELETE CASCADE,
  sentence_id UUID NOT NULL REFERENCES shadowing_sentences(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
  sentence_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms >= start_ms)
);
CREATE UNIQUE INDEX shadowing_segments_video_index_unique ON shadowing_segments(video_id, segment_index);
```

No existing table changes. The tables are not added to `retentionTableNames` (NFR-040).

## Drizzle + Effect Schemas

```typescript
// packages/infra/db/src/schema.ts (excerpt)
export const shadowingVideos = pgTable('shadowing_videos', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  youtubeVideoId: text('youtube_video_id').notNull(),
  title: text('title').notNull().default(''),
  thumbnailUrl: text('thumbnail_url'),
  durationSeconds: integer('duration_seconds'),
  captionKind: text('caption_kind', { enum: shadowingCaptionKinds }),
  status: text('status', { enum: shadowingVideoStatuses }).notNull().default('importing'),
  failureReason: text('failure_reason', { enum: shadowingFailureReasons }),
  failureMessage: text('failure_message'),
  sentenceCount: integer('sentence_count').notNull().default(0),
  lastSegmentIndex: integer('last_segment_index').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [uniqueIndex('shadowing_videos_user_youtube_unique').on(t.userId, t.youtubeVideoId)])
// shadowingSentences.explanation: jsonb('explanation').$type<ShadowingExplanationJson>()
```

Effect row schemas in `packages/infra/db/src/effect-schemas/shadowing-videos.ts`,
`shadowing-sentences.ts`, `shadowing-segments.ts` (exported from `effect-schemas/index.ts`);
factories `createShadowingVideoFactory`, `createShadowingSentenceFactory`,
`createShadowingSegmentFactory` in `packages/infra/db/src/factories/`.

## Entity Relationship Diagram

```
┌──────────┐ 1:N ┌──────────────────┐ 1:N ┌──────────────────────┐ 1:N ┌─────────────────────┐
│  users   │────<│ shadowing_videos │────<│ shadowing_sentences  │────<│ shadowing_segments  │
│          │     │ unique(user,yt)  │     │ unique(video,index)  │     │ unique(video,index) │
└──────────┘     └──────────────────┘     └──────────────────────┘     └─────────────────────┘
                         └──────────────────────────── 1:N (video_id) ────────────┘
```

# Invariants

```yaml
invariants:
  - id: INV-SHADOW-001
    statement: "Submitting a recognisable YouTube URL creates exactly one video per (user, YouTube id) in status importing together with one shadowing.video_import_requested outbox event in the same transaction; re-submitting returns the existing row and writes no event."
    severity: critical
    verified_by:
      - apps/api/src/routes/shadowing.integration.test.ts
    traces_to: [REQ-SHADOW-001, REQ-SHADOW-002, REQ-SHADOW-303]
  - id: INV-SHADOW-002
    statement: "An unrecognisable URL is rejected with 400 and writes no video row and no outbox event."
    severity: high
    verified_by:
      - apps/api/src/routes/shadowing.integration.test.ts
      - packages/core/src/domains/shadowing/domain/youtube-url.test.ts
    traces_to: [REQ-SHADOW-400]
  - id: INV-SHADOW-003
    statement: "Caption track selection prefers a manual English track over an automatic one, and returns none when neither exists."
    severity: high
    verified_by:
      - packages/core/src/domains/shadowing/domain/caption-transcript.test.ts
    traces_to: [REQ-SHADOW-003]
  - id: INV-SHADOW-004
    statement: "Stored sentences reproduce the caption word sequence exactly after normalisation (no word added, removed, reordered or changed), and each sentence's start and end come from its first and last caption word."
    severity: critical
    verified_by:
      - packages/core/src/domains/shadowing/domain/sentence-alignment.test.ts
      - apps/worker/src/shadowing-activities.integration.test.ts
    traces_to: [REQ-SHADOW-004, REQ-SHADOW-005]
  - id: INV-SHADOW-005
    statement: "Segments of a sentence cover all of its words in order without overlap, each segment is within the word and duration limits unless no clause boundary or positive timing gap allows it, and a sentence has exactly one explanation regardless of its segment count."
    severity: high
    verified_by:
      - packages/core/src/domains/shadowing/domain/practice-segments.test.ts
    traces_to: [REQ-SHADOW-006, REQ-SHADOW-008]
  - id: INV-SHADOW-006
    statement: "Segment splitting makes no LLM call and is deterministic: the same sentence and timings always yield the same segments."
    severity: medium
    verified_by:
      - packages/core/src/domains/shadowing/domain/practice-segments.test.ts
    traces_to: [REQ-SHADOW-007]
  - id: INV-SHADOW-007
    statement: "After segmentation every sentence is pending and the import workflow explains batches until no pending sentence remains, choosing the batch with the latest explanation_requested_at first and otherwise the lowest batch_index."
    severity: high
    verified_by:
      - apps/worker/src/shadowing-activities.integration.test.ts
      - apps/worker/src/shadowing-workflow.integration.test.ts
    traces_to: [REQ-SHADOW-010, REQ-SHADOW-014]
  - id: INV-SHADOW-008
    statement: "Every explanation request for a video starts with the same system message and the same transcript message containing the title and every sentence; only the final task message differs between batches."
    severity: high
    verified_by:
      - packages/core/src/domains/shadowing/domain/prompts.test.ts
    traces_to: [REQ-SHADOW-011, REQ-SHADOW-302]
  - id: INV-SHADOW-009
    statement: "A stored explanation has exactly the fields meaning, keyExpressions and toneAndContext and covers exactly the requested sentence indexes; any other LLM output fails the attempt and nothing is stored."
    severity: critical
    verified_by:
      - packages/core/src/domains/shadowing/domain/explanation.test.ts
      - apps/worker/src/shadowing-activities.integration.test.ts
    traces_to: [REQ-SHADOW-012, REQ-SHADOW-405]
  - id: INV-SHADOW-010
    statement: "The explanation prompt instructs Chinese output with English expressions quoted verbatim, and each keyExpressions[].expression is a substring of the sentence it explains."
    severity: medium
    verified_by:
      - packages/core/src/domains/shadowing/domain/explanation.test.ts
      - packages/core/src/domains/shadowing/domain/prompts.test.ts
    traces_to: [REQ-SHADOW-013]
  - id: INV-SHADOW-011
    statement: "A video becomes ready only after its sentences are stored and batch 0 is settled (ready or failed); later batches may still be pending."
    severity: high
    verified_by:
      - apps/worker/src/shadowing-activities.integration.test.ts
    traces_to: [REQ-SHADOW-015]
  - id: INV-SHADOW-012
    statement: "Regeneration is accepted only from ready or failed, moves the sentence to regenerating with an outbox event in one transaction, and its result replaces the stored explanation; the import workflow never writes a sentence that is not pending."
    severity: high
    verified_by:
      - apps/api/src/routes/shadowing.integration.test.ts
      - apps/worker/src/shadowing-activities.integration.test.ts
    traces_to: [REQ-SHADOW-016]
  - id: INV-SHADOW-013
    statement: "Read endpoints serve stored explanations from the database and never call the LLM."
    severity: high
    verified_by:
      - apps/api/src/routes/shadowing.integration.test.ts
    traces_to: [REQ-SHADOW-017]
  - id: INV-SHADOW-014
    statement: "The practice page pauses the player once currentTime reaches the current segment's end plus SHADOWING_PAUSE_PADDING_MS, shows that sentence's explanation, and never starts playback on its own afterwards."
    severity: critical
    verified_by:
      - apps/web/components/shadowing/useYouTubeSegmentPlayer.test.ts
      - apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx
    traces_to: [REQ-SHADOW-020, REQ-SHADOW-021, REQ-SHADOW-022]
  - id: INV-SHADOW-015
    statement: "On the practice page Space replays, ArrowRight advances, ArrowLeft goes back, S toggles 1x/0.75x and H toggles the subtitle; selecting a sentence seeks to its first segment; the subtitle choice persists across visits."
    severity: medium
    verified_by:
      - apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx
    traces_to: [REQ-SHADOW-023, REQ-SHADOW-024, REQ-SHADOW-025]
  - id: INV-SHADOW-016
    statement: "The library lists only the caller's videos with title, thumbnail, duration, status and explained/total counts, and opening a video starts at last_segment_index, which is updated whenever the current segment changes."
    severity: high
    verified_by:
      - apps/api/src/routes/shadowing.integration.test.ts
      - apps/web/app/(application)/shadowing/page.integration.test.tsx
      - apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx
    traces_to: [REQ-SHADOW-030, REQ-SHADOW-031, REQ-SHADOW-032]
  - id: INV-SHADOW-017
    statement: "Deleting a video removes its sentences and segments by cascade and leaves other videos untouched."
    severity: medium
    verified_by:
      - apps/api/src/routes/shadowing.integration.test.ts
    traces_to: [REQ-SHADOW-033]
  - id: INV-SHADOW-018
    statement: "Every shadowing endpoint returns 401 without a valid token, and any request for another user's video or sentence returns 404 exactly like a missing id."
    severity: critical
    verified_by:
      - apps/api/src/routes/shadowing.integration.test.ts
    traces_to: [REQ-SHADOW-100, REQ-SHADOW-101, REQ-SHADOW-102]
  - id: INV-SHADOW-019
    statement: "LLM calls go to SHADOWING_LLM_BASE_URL/chat/completions with SHADOWING_LLM_MODEL for both segmentation and explanation; missing variables fail the import with import_error and a message naming each missing variable."
    severity: high
    verified_by:
      - packages/infra/ai/src/openai-compatible.test.ts
      - apps/worker/src/shadowing-activities.integration.test.ts
    traces_to: [REQ-SHADOW-300, REQ-SHADOW-301, REQ-SHADOW-407]
  - id: INV-SHADOW-020
    statement: "yt-dlp is executed with execFile and an argument array from YT_DLP_PATH (default yt-dlp), only after the video id matched ^[A-Za-z0-9_-]{11}$, and caption files are deleted before the activity returns."
    severity: critical
    verified_by:
      - apps/worker/src/shadowing-activities.integration.test.ts
    traces_to: [REQ-SHADOW-304]
  - id: INV-SHADOW-021
    statement: "No English captions fails the import with no_captions, non-embeddable fails with not_embeddable, and any other fetch or segmentation failure fails with import_error; a failed video can be retried, which writes a new import event."
    severity: high
    verified_by:
      - apps/worker/src/shadowing-activities.integration.test.ts
      - apps/api/src/routes/shadowing.integration.test.ts
    traces_to: [REQ-SHADOW-401, REQ-SHADOW-402, REQ-SHADOW-406]
  - id: INV-SHADOW-022
    statement: "An explanation batch is attempted at most 3 times; after the third failure its pending sentences become failed and the workflow continues with the remaining batches."
    severity: high
    verified_by:
      - apps/worker/src/shadowing-workflow.integration.test.ts
    traces_to: [REQ-SHADOW-403, REQ-SHADOW-404]
  - id: INV-SHADOW-023
    statement: "Re-running the import workflow for a video replaces its sentences and segments in one transaction, so a video never has duplicate sentence or segment indexes."
    severity: high
    verified_by:
      - apps/worker/src/shadowing-activities.integration.test.ts
    traces_to: [REQ-SHADOW-303]
```

# Failure Modes

```yaml
failure_modes:
  - condition: "Video has no English manual or automatic captions"
    impact: "Video cannot be practiced."
    handling: "CaptionSourcePort returns NoCaptionsError; activity throws ApplicationFailure.nonRetryable('no_captions'); workflow sets status failed, failure_reason no_captions; library shows 'not supported'. Logged at info with videoId."
  - condition: "yt-dlp reports playable_in_embed = false"
    impact: "The IFrame player cannot play it."
    handling: "NotEmbeddableError → non-retryable; status failed, failure_reason not_embeddable; library shows 'not supported'."
  - condition: "yt-dlp missing, outdated or blocked; network error; LLM segmentation fails or alignment rejects its output"
    impact: "Import cannot finish."
    handling: "prepareShadowingTranscript retries 3 times (initial 5 s, backoff 2); after the last attempt the workflow sets failed / import_error with the last error message (stderr tail, no secrets). The learner upgrades yt-dlp or fixes the endpoint and presses Retry, which writes a new import event."
  - condition: "SHADOWING_LLM_API_KEY, SHADOWING_LLM_BASE_URL or SHADOWING_LLM_MODEL missing"
    impact: "No LLM work possible."
    handling: "LlmNotConfiguredError is non-retryable; failure_message lists the missing variable names; the key value is never logged."
  - condition: "Explanation batch returns malformed JSON, wrong indexes, HTTP 5xx/429, or times out"
    impact: "Batch sentences stay pending."
    handling: "explainShadowingBatch fails the attempt; Temporal retries up to 3 attempts in total; then markShadowingBatchFailed sets those sentences to failed with a regenerate button; the loop continues with the next batch (NFR-012). Token usage and failure reason are logged per batch."
  - condition: "Transcript exceeds the model context window"
    impact: "Every batch of the video fails."
    handling: "Endpoint 400 is surfaced as the batch error message 'transcript too long for model: N sentences, ~T tokens'; sentences become failed; the learner can switch SHADOWING_LLM_MODEL and regenerate."
  - condition: "Video deleted while a workflow is running"
    impact: "Workflow writes would target missing rows."
    handling: "Activities check the video first and return a gone outcome; the workflow returns normally. Cascading delete removes all rows; storeExplanations updates zero rows."
  - condition: "Outbox event delivered twice"
    impact: "Duplicate workflow start."
    handling: "workflowId shadowing-import-${event.id} with REJECT_DUPLICATE makes the second start a no-op; replaceTranscript keeps the data idempotent even if a retry re-runs the workflow (NFR-010, NFR-011)."
```

# Verification

```yaml
verification:
  - requirement_id: REQ-SHADOW-001
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#creates an importing video and an import event
  - requirement_id: REQ-SHADOW-002
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#returns the existing video for a repeated URL
  - requirement_id: REQ-SHADOW-003
    test_type: unit
    target: packages/core/src/domains/shadowing/domain/caption-transcript.test.ts#prefers manual English captions
  - requirement_id: REQ-SHADOW-004
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#stores aligned sentences with caption timings
  - requirement_id: REQ-SHADOW-005
    test_type: property
    target: packages/core/src/domains/shadowing/domain/sentence-alignment.test.ts#rejects any added, dropped or changed word
  - requirement_id: REQ-SHADOW-006
    test_type: property
    target: packages/core/src/domains/shadowing/domain/practice-segments.test.ts#segments cover the sentence in order within limits
  - requirement_id: REQ-SHADOW-007
    test_type: unit
    target: packages/core/src/domains/shadowing/domain/practice-segments.test.ts#splits at compromise clause boundaries deterministically
  - requirement_id: REQ-SHADOW-008
    test_type: unit
    target: packages/core/src/domains/shadowing/domain/practice-segments.test.ts#falls back to the longest pause, else keeps the sentence whole
  - requirement_id: REQ-SHADOW-010
    test_type: integration
    target: apps/worker/src/shadowing-workflow.integration.test.ts#explains all batches in order
  - requirement_id: REQ-SHADOW-011
    test_type: unit
    target: packages/core/src/domains/shadowing/domain/prompts.test.ts#includes title and full transcript in every batch
  - requirement_id: REQ-SHADOW-012
    test_type: unit
    target: packages/core/src/domains/shadowing/domain/explanation.test.ts#accepts exactly meaning, keyExpressions and toneAndContext
  - requirement_id: REQ-SHADOW-013
    test_type: unit
    target: packages/core/src/domains/shadowing/domain/explanation.test.ts#key expressions are English substrings of the sentence
  - requirement_id: REQ-SHADOW-014
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#prioritised batch is selected next
  - requirement_id: REQ-SHADOW-015
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#video is ready once batch 0 settles
  - requirement_id: REQ-SHADOW-016
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#regenerate moves a sentence to regenerating with an event
  - requirement_id: REQ-SHADOW-017
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#detail serves stored explanations without LLM calls
  - requirement_id: REQ-SHADOW-020
    test_type: integration
    target: apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx#mounts the YouTube IFrame player for the video
  - requirement_id: REQ-SHADOW-021
    test_type: unit
    target: apps/web/components/shadowing/useYouTubeSegmentPlayer.test.ts#pauses at segment end plus padding
  - requirement_id: REQ-SHADOW-022
    test_type: unit
    target: apps/web/components/shadowing/useYouTubeSegmentPlayer.test.ts#stays paused until a navigation action
  - requirement_id: REQ-SHADOW-023
    test_type: integration
    target: apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx#keyboard shortcuts
  - requirement_id: REQ-SHADOW-024
    test_type: integration
    target: apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx#remembers subtitle visibility
  - requirement_id: REQ-SHADOW-025
    test_type: integration
    target: apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx#selecting a sentence seeks to its first segment
  - requirement_id: REQ-SHADOW-030
    test_type: integration
    target: apps/web/app/(application)/shadowing/page.integration.test.tsx#lists videos with status and progress
  - requirement_id: REQ-SHADOW-031
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#saves progress
  - requirement_id: REQ-SHADOW-032
    test_type: integration
    target: apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx#resumes at the last practiced segment
  - requirement_id: REQ-SHADOW-033
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#delete cascades sentences and segments
  - requirement_id: REQ-SHADOW-100
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#rejects unauthenticated requests
  - requirement_id: REQ-SHADOW-101
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#lists only the caller's videos
  - requirement_id: REQ-SHADOW-102
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#returns 404 for another user's video
  - requirement_id: REQ-SHADOW-300
    test_type: unit
    target: packages/infra/ai/src/openai-compatible.test.ts#posts to base URL chat completions with bearer key
  - requirement_id: REQ-SHADOW-301
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#segmentation and explanation use the configured model
  - requirement_id: REQ-SHADOW-302
    test_type: unit
    target: packages/core/src/domains/shadowing/domain/prompts.test.ts#transcript prefix is identical across batches
  - requirement_id: REQ-SHADOW-303
    test_type: unit
    target: apps/worker/src/dispatch/resolve-dispatch.test.ts#dispatches shadowing events to their workflows
  - requirement_id: REQ-SHADOW-304
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#runs yt-dlp from YT_DLP_PATH with an argument array
  - requirement_id: REQ-SHADOW-400
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#rejects non-YouTube URLs
  - requirement_id: REQ-SHADOW-401
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#fails with no_captions
  - requirement_id: REQ-SHADOW-402
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#fails with not_embeddable
  - requirement_id: REQ-SHADOW-403
    test_type: integration
    target: apps/worker/src/shadowing-workflow.integration.test.ts#retries a failing batch three times
  - requirement_id: REQ-SHADOW-404
    test_type: integration
    target: apps/worker/src/shadowing-workflow.integration.test.ts#marks a batch failed and continues
  - requirement_id: REQ-SHADOW-405
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#malformed LLM output stores nothing
  - requirement_id: REQ-SHADOW-406
    test_type: integration
    target: apps/api/src/routes/shadowing.integration.test.ts#retry resets a failed import and writes an event
  - requirement_id: REQ-SHADOW-407
    test_type: integration
    target: apps/worker/src/shadowing-activities.integration.test.ts#names missing LLM variables
```

# Sequence Diagrams

## Happy Path: Import and first practice

```
Web            API                 Core/DB               Dispatcher        Workflow / Activities       yt-dlp   LLM
 │ POST videos  │                     │                      │                   │                       │       │
 │─────────────▶│ requireAuth         │                      │                   │                       │       │
 │              │ parseYoutubeVideoId │                      │                   │                       │       │
 │              │ insertVideoWithImportEvent (1 txn) ───────▶│ NOTIFY            │                       │       │
 │ 200 created  │◀────────────────────│                      │                   │                       │       │
 │◀─────────────│                     │                      │ start shadowingImportWorkflow(event)     │       │
 │              │                     │                      │──────────────────▶│ prepareShadowingTranscript    │
 │              │                     │                      │                   │──── metadata + json3 ─▶│       │
 │              │                     │                      │                   │──── segment chunks ───────────▶│
 │              │                     │◀── replaceTranscript, status explaining ─│                       │       │
 │              │                     │                      │                   │ loop: nextShadowingExplanationBatch
 │              │                     │                      │                   │       explainShadowingBatch ──▶│
 │              │                     │◀── storeExplanations (pending rows only)─│                       │       │
 │              │                     │◀── status ready after batch 0 settles ───│                       │       │
 │ GET video (poll 3 s while not ready) │                    │                   │                       │       │
 │─────────────▶│────────────────────▶│                      │                   │                       │       │
 │ detail       │◀────────────────────│                      │                   │                       │       │
 │ seek last_segment_index, play; pause at end + 200 ms; show explanation; PUT progress on segment change
```

## Error Path: Batch fails three times, then the learner jumps ahead

```
Workflow                 explainShadowingBatch        DB                       Web/API
 │ batch 2                   │                          │                         │
 │──────────────────────────▶│ 429 / malformed JSON     │                         │
 │◀── attempt 1 failed ──────│                          │                         │
 │ (Temporal retry, 5 s, 10 s)                          │                         │
 │──────────────────────────▶│ fails (attempt 3)        │                         │
 │ catch ActivityFailure      │                          │                         │
 │ markShadowingBatchFailed ─────────────────────────────▶ batch 2 → failed       │
 │ next batch                 │                          │◀── POST prioritize s=95 (batch 4)
 │ nextShadowingExplanationBatch → 4 (latest requested_at)                        │
 │ explain batch 4 ... continue                          │◀── POST regenerate s=41 → regenerating + event
```

## Error Path: Video without captions

```
Workflow              prepareShadowingTranscript      yt-dlp            DB
 │──────────────────────────▶│ --dump-single-json ────▶│                 │
 │                           │◀── no en subtitles ─────│                 │
 │◀── nonRetryable no_captions                          │                 │
 │ failShadowingImport(no_captions) ─────────────────────────────────────▶ status failed
```

# Workflows and Activities

```typescript
// apps/worker/src/workflows.ts (additions)
const { prepareShadowingTranscript } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: { maximumAttempts: 3, initialInterval: '5 seconds', backoffCoefficient: 2 }
})
const { explainShadowingBatch, regenerateShadowingExplanation } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: SHADOWING_EXPLANATION_MAX_ATTEMPTS, initialInterval: '5 seconds', backoffCoefficient: 2 }
})
const { nextShadowingExplanationBatch, markShadowingBatchFailed, failShadowingImport, markShadowingVideoReady, failShadowingRegeneration } =
  proxyActivities<typeof activities>({ startToCloseTimeout: '30 seconds', retry: { maximumAttempts: 3, initialInterval: '1 second' } })

export async function shadowingImportWorkflow(event: SerializedDomainEvent): Promise<void> {
  const videoId = /* typeof-narrowed event.payload.videoId */
  try {
    const prepared = await prepareShadowingTranscript(videoId)      // { outcome: 'ok' | 'gone' }
    if (prepared.outcome === 'gone') return
  } catch (err) {
    await failShadowingImport(videoId, failureReasonOf(err), messageOf(err)) // no_captions | not_embeddable | import_error
    return
  }
  for (;;) {
    const next = await nextShadowingExplanationBatch(videoId)        // { batchIndex } | null; null also when video gone
    if (next === null) break
    try { await explainShadowingBatch(videoId, next.batchIndex) }
    catch { await markShadowingBatchFailed(videoId, next.batchIndex) }
    if (next.batchIndex === 0) await markShadowingVideoReady(videoId)
  }
  await markShadowingVideoReady(videoId)                             // idempotent; covers videos with zero batches left
}

export async function shadowingRegenerateWorkflow(event: SerializedDomainEvent): Promise<void> {
  const sentenceId = /* narrowed */
  try { await regenerateShadowingExplanation(sentenceId) }
  catch (err) { await failShadowingRegeneration(sentenceId, messageOf(err)) }
}
```

Dispatch cases in `resolve-dispatch.ts`: `'shadowing.video_import_requested'` →
`{ workflowType: 'shadowingImportWorkflow', workflowId: \`shadowing-import-${event.id}\`, workflowRunTimeout: '24 hours' }`;
`'shadowing.explanation_regenerate_requested'` → `shadowingRegenerateWorkflow`,
`shadowing-regenerate-${event.id}`, `'15 minutes'`. Both validate the payload with the
payload fields with `typeof` checks (the same pattern as the assets case; `apps/worker` does not depend on
`@tx-agent-kit/temporal-client`) and return `invalid` on mismatch.

Activities in `apps/worker/src/shadowing-activities.ts` build
`Layer.mergeAll(ShadowingImportServiceLive, ShadowingStorePortLive, YtDlpCaptionSourceLive(getWorkerEnv().YT_DLP_PATH), ShadowingLlmPortLive)`
and run the service with `Effect.runPromise`; domain errors that must not retry become
`ApplicationFailure.nonRetryable(message, reason)`.

# Testing Strategy

## Integration Tests

| Test File | What It Covers | Invariants |
|-----------|----------------|------------|
| `apps/api/src/routes/shadowing.integration.test.ts` | All endpoints via `createTestFixture({ schemaPrefix: 'api_shadowing' })`: create + outbox row, dedupe, invalid URL, 401 on every route, 404 across users, list scoping, detail with stored explanations, progress, prioritise, regenerate 202/409, retry 202/409, delete cascade | 001, 002, 012, 013, 016, 017, 018, 021 |
| `apps/worker/src/shadowing-activities.integration.test.ts` | Activities against Postgres with `YT_DLP_PATH` pointing at a fixture script (`apps/worker/src/__fixtures__/fake-yt-dlp.mjs`, records argv, serves json3 fixtures for manual, auto, no-captions, non-embeddable ids) and a local HTTP stub implementing `/chat/completions` (records requests, scripted responses) | 004, 007, 009, 011, 012, 019, 020, 021, 023 |
| `apps/worker/src/shadowing-workflow.integration.test.ts` | Real Temporal worker (pattern of `activities.integration.test.ts`) with stub activities: batch order, retry count 3, mark failed and continue, ready after batch 0, gone outcome | 007, 022 |
| `apps/web/app/(application)/shadowing/page.integration.test.tsx` | Library renders the user's videos with status, counts and "not supported" for failed reasons; import form | 016 |
| `apps/web/app/(application)/shadowing/[videoId]/page.integration.test.tsx` | Practice page with a fake player injected through `ShadowingPlayerContext`: mounts player, explanation shown on pause, shortcuts, sentence list seek, subtitle persistence, resume at last segment, prioritise call for pending batch | 014, 015, 016 |

## Unit Tests

| Test File | What It Covers | Invariants |
|-----------|----------------|------------|
| `packages/core/src/domains/shadowing/domain/youtube-url.test.ts` | Accepted URL shapes; rejection of other hosts, playlists without v, ids of wrong length | 002 |
| `packages/core/src/domains/shadowing/domain/caption-transcript.test.ts` | Track selection order; json3 word timing, proportional fallback, rolling duplicate removal | 003 |
| `packages/core/src/domains/shadowing/domain/sentence-alignment.test.ts` | Property: random punctuation/case changes align; any inserted, dropped, swapped or changed token is rejected; timings from first/last word | 004 |
| `packages/core/src/domains/shadowing/domain/practice-segments.test.ts` | Property: coverage, order, no overlap, limits; clause split; gap fallback; whole sentence when no gap; determinism | 005, 006 |
| `packages/core/src/domains/shadowing/domain/explanation.test.ts` | Schema accepts exactly three fields; index set mismatch rejected; expressions must be substrings | 009, 010 |
| `packages/core/src/domains/shadowing/domain/prompts.test.ts` | Identical system + transcript messages across batches; Chinese instruction present | 008, 010 |
| `packages/infra/ai/src/openai-compatible.test.ts` | URL join, bearer header, model, JSON mode, usage incl. cached tokens, missing env names, key not in errors | 019 |
| `apps/worker/src/dispatch/resolve-dispatch.test.ts` (extend) | Both new cases, workflow ids, invalid payloads | 001 |
| `apps/web/components/shadowing/useYouTubeSegmentPlayer.test.ts` | Pause threshold with fake timers and fake player; no auto-resume | 014 |

## Test Annotation Convention

Test names carry the invariant id, e.g. `it('returns 404 for another user\'s video [INV-SHADOW-018]', ...)`.
Results are recorded with `vitest run --reporter=json --outputFile=.tx/spec-results.json` and
`tx spec batch --from vitest < .tx/spec-results.json`.

# Security Considerations

| Concern | Mitigation | Enforcement |
|---------|-----------|-------------|
| Cross-user access | Every query filters by `user_id` from `requireAuth`; foreign ids return 404 | INV-SHADOW-018 tests |
| Command injection via yt-dlp | `execFile` with an argument array, id validated by regex before any call, `--` before the URL | INV-SHADOW-020 test records argv |
| LLM key leakage | Read only in `packages/infra/ai/src/env.ts`; never logged, never in API responses, error messages name variables not values | `openai-compatible.test.ts`; `process.env` lint |
| Prompt injection from captions | Output is schema-validated and aligned to caption words; nothing from the LLM is executed or rendered as HTML | INV-SHADOW-004, INV-SHADOW-009 |
| SQL injection | Drizzle parameterised queries only, in `packages/infra/db` | ESLint boundary rules |

# Cross-Cutting Concerns

## Observability

- Logger `createLogger('tx-agent-kit-worker-shadowing')` with `videoId`, `batchIndex`, `attempt`,
  `outcome`, `failureReason`, token counts; no `console.*` (NFR-030).
- `chatCompletionsJson` opens an OpenTelemetry span `shadowing.llm.<step>` with `gen_ai.request.model`,
  `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` and `gen_ai.usage.cached_tokens` from
  `usage.prompt_tokens_details.cached_tokens` when present (NFR-031, NFR-032). Activities run inside
  `runWithActivityContext`, so Temporal spans parent these.

## Data Retention

No retention policy (NFR-040); rows live until the video or the user is deleted. Caption files exist
only in a `mkdtemp` directory removed in a `finally` block (NFR-041).

## Configuration

| Variable | Read by | Default |
|----------|---------|---------|
| `SHADOWING_LLM_API_KEY` | `packages/infra/ai/src/env.ts` `getShadowingLlmEnv()` | none (required) |
| `SHADOWING_LLM_BASE_URL` | same | none (required), e.g. `https://api.openai.com/v1` |
| `SHADOWING_LLM_MODEL` | same | none (required) |
| `YT_DLP_PATH` | `apps/worker/src/config/env.ts` | `yt-dlp` |

Added to `.env.example` with comments. `.agents/setup` installs yt-dlp (pip `--user` pinned version)
so orbs can run the worker; learners install it locally.

# Migration Strategy

## Database Migration

**File:** `packages/infra/db/drizzle/migrations/0057_shadowing.sql`, applied with `pnpm db:migrate`.
Only new tables; no backfill.

## Rollback Plan

| Step | Action | Verification |
|------|--------|-------------|
| 1 | Remove the `shadowing` nav entry and routes from web; remove the API group | `pnpm type-check`, API returns 404 for `/v1/shadowing/*` |
| 2 | Remove dispatch cases; pending events become `invalid` and are marked failed | worker logs, `domain_events` rows failed |
| 3 | `DROP TABLE shadowing_segments, shadowing_sentences, shadowing_videos` in a new migration | `\dt shadowing_*` empty |

# Implementation Sequence

```
Phase 1: Contracts and pure domain
  ├── packages/contracts/src/literals.ts, constants.ts, shadowing.ts, index.ts
  ├── packages/temporal-client/src/types/domain-event.ts
  ├── packages/core/src/domains/shadowing/{events.ts, domain/*.ts}  (+ unit/property tests)
  └── packages/core/package.json: add compromise@14.19.0

Phase 2: Persistence
  ├── packages/infra/db/src/schema.ts, effect-schemas/shadowing-*.ts, factories/shadowing-*.factory.ts
  ├── packages/infra/db/src/repositories/shadowing.ts (insertDomainEventInTransaction)
  └── packages/infra/db/drizzle/migrations/0057_shadowing.sql

Phase 3: LLM client and caption source
  ├── packages/infra/ai/src/{env.ts, openai-compatible.ts, index.ts} (+ openai-compatible.test.ts)
  └── packages/core/src/domains/shadowing/adapters/{yt-dlp-caption-source.ts, shadowing-llm.ts}

Phase 4: Application layer
  ├── packages/core/src/domains/shadowing/ports/shadowing-ports.ts
  ├── packages/core/src/domains/shadowing/application/{shadowing-service.ts, shadowing-import-service.ts}
  ├── packages/core/src/domains/shadowing/adapters/shadowing-store.ts
  ├── packages/core/src/adapters/shadowing-row-mappers.ts (+ db-row-mappers.ts re-export)
  └── packages/core/src/index.ts exports

Phase 5: API
  ├── apps/api/src/api.ts (ShadowingGroup), apps/api/src/routes/shadowing.ts, server-lib.ts
  ├── apps/api/src/routes/shadowing.integration.test.ts
  └── pnpm openapi:generate && pnpm api:client:generate

Phase 6: Worker
  ├── apps/worker/package.json (+ @tx-agent-kit/ai), config/env.ts (YT_DLP_PATH)
  ├── apps/worker/src/dispatch/resolve-dispatch.ts (+ test cases)
  ├── apps/worker/src/shadowing-activities.ts, activities.ts (combinedActivities), workflows.ts
  └── shadowing-activities.integration.test.ts, shadowing-workflow.integration.test.ts, __fixtures__/fake-yt-dlp.mjs

Phase 7: Web
  ├── apps/web/components/shadowing/{useYouTubeSegmentPlayer.ts, ExplanationPanel.tsx, SentenceList.tsx, useShadowingShortcuts.ts, ShadowingPlayerContext.tsx}
  ├── apps/web/app/(application)/shadowing/page.tsx, [videoId]/page.tsx (+ integration tests)
  └── apps/web/components/AppShell.tsx nav entry

Phase 8: Quality gates
  ├── pnpm lint && pnpm type-check && pnpm test && pnpm test:integration:quiet
  ├── tx spec discover --doc youtube-shadowing-design
  └── tx spec fci --doc youtube-shadowing-design
```

# Open Questions

- [ ] Segment limits (25 words / 8 s) and batch size (20) are constants; confirm after practicing a few real videos.
- [ ] Which model to configure; compare explanation quality and cached-token rates on 2–3 videos.
- [ ] Whether `playable_in_embed` from yt-dlp is reliable for every non-embeddable case, or an oEmbed check should be added later.
