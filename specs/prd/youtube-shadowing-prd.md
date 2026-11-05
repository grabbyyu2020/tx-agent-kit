---
kind: spec
spec_type: prd
doc_id: doc-8362a6d266f2
name: youtube-shadowing-prd
title: "YouTube Shadowing Practice"
status: draft
version: 1
owners:
  - test-olim
summary: "Personal tool for shadowing YouTube videos sentence by sentence, with LLM explanations of each sentence in Chinese."
domain: shadowing
tags:
  - prd
  - youtube
  - shadowing
  - ai
  - temporal
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-11-05
plan: "~/.claude/plans/youtube-shadowing.md"
---

# Plan

> Full plan: `~/.claude/plans/youtube-shadowing.md`

The plan records the 18 decisions settled in a grilling session on 2026-11-05: a personal,
locally run tool built inside tx-agent-kit; captions downloaded with yt-dlp and re-segmented by an
LLM; sentence-by-sentence shadowing on an embedded YouTube player; and Chinese explanations
generated in background batches with the full transcript as context.

# Summary

Shadowing YouTube videos is an effective way to practice spoken English, but the learner often
repeats a sentence without fully understanding what it means, which expressions it uses, or why
the speaker said it that way. This feature lets the learner import a YouTube video, practice it
one sentence at a time, and read an LLM explanation of each sentence in Chinese covering its
meaning, its key expressions, and its tone and context, so the expressions can be reused later.

# Problem

## Current State

The learner shadows YouTube videos by hand: pausing the player at the end of each sentence,
dragging the progress bar back to replay it, and pasting sentences into a chat assistant to ask
what they mean. Each step breaks the practice rhythm. Caption timing on YouTube does not align
with sentence boundaries (auto-generated captions have no punctuation and roll across lines), so
pausing "at the end of a sentence" is guesswork. Explanations from a chat assistant lack the
context of the surrounding conversation, so tone, irony, and references such as "it" or "that"
are often explained wrongly.

## Impact

- Practice time is spent on player control instead of speaking: roughly every 5–10 seconds of
  video requires a manual pause and seek.
- Sentences are repeated without understanding, so expressions are not retained or reused.
- Context-free explanations mislead the learner on tone and implied meaning.

# Scope

## Included

- Video import from a YouTube URL: metadata lookup, embeddability check, English caption
  download with yt-dlp (manual captions before auto-generated), LLM sentence segmentation with
  derived timings, and deterministic splitting of over-long sentences into practice segments
  at clause boundaries found with the open-source `compromise` NLP library.
- Background explanation generation in batches using the full transcript as context, with
  on-demand prioritisation, automatic retry, and per-sentence regeneration.
- Practice page: embedded YouTube IFrame player, automatic pause at each segment end, manual
  navigation, keyboard shortcuts, playback speed toggle, subtitle visibility toggle, sentence
  list, and explanation panel.
- Video library: list of imported videos with explanation progress and resume at the last
  practiced sentence.
- An OpenAI-compatible LLM client configured with the learner's own API key, base URL, and model.
- Affected code: a new `shadowing` domain under `packages/core/src/domains/shadowing/`, new tables
  in `packages/infra/db`, API routes in `apps/api`, workflows and activities in `apps/worker`,
  contracts in `packages/contracts`, and pages in `apps/web`.

## Excluded

- Recording the learner's voice, playback comparison, and any pronunciation scoring.
- Speech recognition for videos without captions.
- Simultaneous (non-pausing) shadowing and automatic advance to the next sentence.
- Saving expressions, a phrasebook, and spaced repetition.
- Explanation sections for grammar, example sentences, or pronunciation.
- Manual editing of explanations.
- Practice statistics, streaks, and time tracking.
- Billing, credits, quotas, organization or workspace scoping, and public sign-up.
- Production deployment, yt-dlp cookies or proxies, and video downloads.
- Changes to the existing OpenRouter module in `packages/infra/ai`.

# User Personas

## Persona 1: Self-directed English learner

| Attribute | Detail |
|-----------|--------|
| Role | A native Chinese speaker practicing spoken English alone, using YouTube interviews, talks, vlogs, and podcasts |
| Goals | Speak along with native speakers sentence by sentence; understand what each sentence means, which expressions it uses, and why it is said that way; reuse those expressions in their own speech |
| Pain Points | Manual pausing and seeking; caption lines that do not match sentences; context-free explanations that miss tone and references |
| Technical Proficiency | High: runs the app locally with `pnpm dev`, supplies their own LLM endpoint and API key |

# Requirements

## EARS Requirements

### Core Requirements: Import and Segmentation

```yaml
ears_requirements:
  - id: REQ-SHADOW-001
    kind: event-driven
    when: "the learner submits a YouTube video URL"
    statement: "When the learner submits a YouTube video URL, the system shall create a video record in the importing state and start a background import for that video."
    priority: must
    rationale: "Import involves network calls and LLM work that must not block the request."
  - id: REQ-SHADOW-002
    kind: event-driven
    when: "the learner submits a URL for a video the learner has already imported"
    statement: "When the learner submits a URL for a video the learner has already imported, the system shall return the existing video instead of importing it again."
    priority: must
    rationale: "Re-importing would discard progress and repeat LLM cost."
  - id: REQ-SHADOW-003
    kind: ubiquitous
    statement: "The system shall download English captions with yt-dlp, preferring manually created captions over auto-generated captions."
    priority: must
    rationale: "Manual captions have punctuation and accurate wording; auto captions are the fallback."
  - id: REQ-SHADOW-004
    kind: ubiquitous
    statement: "The system shall re-segment the downloaded caption text into complete sentences with an LLM and derive each sentence's start and end time from the caption timings."
    priority: must
    rationale: "Caption cues do not align with sentences; the player must pause at sentence ends."
  - id: REQ-SHADOW-005
    kind: ubiquitous
    statement: "The system shall preserve the caption wording in segmented sentences, changing only punctuation, capitalisation, and removal of duplicated rolling-caption words."
    priority: must
    rationale: "Practice text must match what the speaker says."
  - id: REQ-SHADOW-006
    kind: unwanted
    if: "a sentence is longer than the practice segment limit"
    statement: "If a sentence is longer than the practice segment limit, then the system shall split it into practice segments at clause boundaries while keeping one explanation for the whole sentence."
    priority: must
    rationale: "Long sentences are hard to shadow in one pass, but splitting the explanation would fragment its meaning."
  - id: REQ-SHADOW-007
    kind: ubiquitous
    statement: "The system shall find clause boundaries for practice segments with the `compromise` NLP library, without an LLM call, so that the same sentence always splits into the same segments."
    priority: must
    rationale: "A maintained MIT library (compromise) already provides clause detection; a deterministic split is free, repeatable, and cannot alter the caption wording."
  - id: REQ-SHADOW-008
    kind: unwanted
    if: "`compromise` finds no clause boundary that brings every segment within the practice segment limit"
    statement: "If `compromise` finds no clause boundary that brings every segment within the practice segment limit, then the system shall split at the longest pause between words, and keep the sentence whole when no such pause exists."
    priority: must
    rationale: "Run-on speech without clause markers still needs a usable segment boundary; a word must never be cut."
```

### Core Requirements: Explanations

```yaml
ears_requirements:
  - id: REQ-SHADOW-010
    kind: event-driven
    when: "segmentation of a video completes"
    statement: "When segmentation of a video completes, the system shall generate explanations for all sentences in background batches in sentence order."
    priority: must
    rationale: "Explanations should be ready before the learner reaches each sentence."
  - id: REQ-SHADOW-011
    kind: ubiquitous
    statement: "The system shall include the full video transcript and the video title as context in every explanation request."
    priority: must
    rationale: "Tone, irony, and references can only be explained with the surrounding conversation."
  - id: REQ-SHADOW-012
    kind: ubiquitous
    statement: "The system shall produce each explanation with exactly three parts: the meaning of the whole sentence, its key expressions, and its tone and context."
    priority: must
    rationale: "These are the three parts the learner chose; other parts add reading load."
  - id: REQ-SHADOW-013
    kind: ubiquitous
    statement: "The system shall write explanations in Chinese while keeping the English sentence, phrases, and expressions in English."
    priority: must
    rationale: "The learner understands fastest in their native language but must memorise the English form."
  - id: REQ-SHADOW-014
    kind: event-driven
    when: "the learner opens a sentence whose explanation batch has not been generated"
    statement: "When the learner opens a sentence whose explanation batch has not been generated, the system shall generate that batch before other pending batches."
    priority: must
    rationale: "The learner should not wait for unrelated batches."
  - id: REQ-SHADOW-015
    kind: state-driven
    while: "a video has at least one ready practice segment and its first explanation batch is complete"
    statement: "While a video has its sentences segmented and its first explanation batch complete, the system shall allow the learner to practice it even if later batches are still pending."
    priority: must
    rationale: "Long videos must not block practice until every batch is done."
  - id: REQ-SHADOW-016
    kind: event-driven
    when: "the learner requests regeneration of a sentence's explanation"
    statement: "When the learner requests regeneration of a sentence's explanation, the system shall generate a new explanation for that sentence and replace the stored one."
    priority: must
    rationale: "Some explanations will be vague or wrong; the learner needs a way to retry."
  - id: REQ-SHADOW-017
    kind: ubiquitous
    statement: "The system shall store generated explanations and serve stored explanations on later visits without calling the LLM again."
    priority: must
    rationale: "Repeated practice must cost nothing."
```

### Core Requirements: Practice

```yaml
ears_requirements:
  - id: REQ-SHADOW-020
    kind: ubiquitous
    statement: "The system shall play videos in the official embedded YouTube IFrame player."
    priority: must
    rationale: "Embedding avoids downloading videos and keeps import fast."
  - id: REQ-SHADOW-021
    kind: event-driven
    when: "playback reaches the end of the current practice segment plus the pause padding"
    statement: "When playback reaches the end of the current practice segment plus the pause padding, the system shall pause the player and show the current sentence's explanation."
    priority: must
    rationale: "Pausing at each segment is the core of sentence-by-sentence shadowing."
  - id: REQ-SHADOW-022
    kind: state-driven
    while: "the player is paused at the end of a practice segment"
    statement: "While the player is paused at the end of a practice segment, the system shall stay paused until the learner chooses to replay, go back, or advance."
    priority: must
    rationale: "The learner chose manual advance; the app must not push them forward."
  - id: REQ-SHADOW-023
    kind: ubiquitous
    statement: "The system shall provide keyboard shortcuts on the practice page: Space replays the current segment, Right Arrow advances to the next segment, Left Arrow returns to the previous segment, S toggles playback speed between 1x and 0.75x, and H toggles the English subtitle."
    priority: must
    rationale: "Hands stay on the keyboard while speaking."
  - id: REQ-SHADOW-024
    kind: ubiquitous
    statement: "The system shall show the English subtitle of the current segment by default and remember the subtitle visibility the learner last chose."
    priority: should
    rationale: "Visible by default eases beginners in; hiding trains listening."
  - id: REQ-SHADOW-025
    kind: event-driven
    when: "the learner selects a sentence in the sentence list"
    statement: "When the learner selects a sentence in the sentence list, the system shall seek the player to that sentence's first segment and make it the current segment."
    priority: must
    rationale: "The learner needs to jump to any part of the video."
```

### Core Requirements: Library and Progress

```yaml
ears_requirements:
  - id: REQ-SHADOW-030
    kind: ubiquitous
    statement: "The system shall list the learner's imported videos with title, thumbnail, duration, import status, and explanation progress."
    priority: must
    rationale: "Videos are practiced across several sessions."
  - id: REQ-SHADOW-031
    kind: event-driven
    when: "the current segment changes on the practice page"
    statement: "When the current segment changes on the practice page, the system shall save it as the learner's last practiced position for that video."
    priority: must
    rationale: "Resuming where the learner left off is the main reason for the library."
  - id: REQ-SHADOW-032
    kind: event-driven
    when: "the learner opens a video from the library"
    statement: "When the learner opens a video from the library, the system shall resume practice at the last practiced segment."
    priority: must
    rationale: "Avoids re-finding the position manually."
  - id: REQ-SHADOW-033
    kind: event-driven
    when: "the learner deletes a video from the library"
    statement: "When the learner deletes a video from the library, the system shall delete its sentences, segments, explanations, and progress."
    priority: should
    rationale: "Keeps the library tidy without orphaned data."
```

### Authentication & Authorization Requirements

```yaml
ears_requirements:
  - id: REQ-SHADOW-100
    kind: ubiquitous
    statement: "The system shall require a valid auth token for all shadowing endpoints."
    priority: must
    rationale: "Data belongs to the authenticated user; protects the LLM key once deployed."
  - id: REQ-SHADOW-101
    kind: ubiquitous
    statement: "The system shall scope videos, sentences, explanations, and progress to the user who imported them, without organization or workspace scoping."
    priority: must
    rationale: "It is a personal tool; the tenancy layers add no value."
  - id: REQ-SHADOW-102
    kind: unwanted
    if: "a user requests a video owned by another user"
    statement: "If a user requests a video owned by another user, then the system shall respond as if the video does not exist."
    priority: must
    rationale: "Prevents leaking other users' data if the tool is ever deployed."
```

### Integration Requirements

```yaml
ears_requirements:
  - id: REQ-SHADOW-300
    kind: ubiquitous
    statement: "The system shall call the LLM through an OpenAI-compatible chat completions endpoint configured by an API key, a base URL, and a model name."
    priority: must
    rationale: "The learner uses their own endpoint and key."
  - id: REQ-SHADOW-301
    kind: ubiquitous
    statement: "The system shall use the same configured model for segmentation and explanation."
    priority: must
    rationale: "Settled decision; one model keeps configuration simple."
  - id: REQ-SHADOW-302
    kind: ubiquitous
    statement: "The system shall order every explanation request so that the full transcript forms an identical prefix across batches of the same video."
    priority: should
    rationale: "Lets endpoints with prompt caching bill the repeated transcript at the cached rate."
  - id: REQ-SHADOW-303
    kind: ubiquitous
    statement: "The system shall start background imports through the transactional outbox and run them as Temporal workflows."
    priority: must
    rationale: "Repository rule: domain events flow through the outbox and the API never imports Temporal."
  - id: REQ-SHADOW-304
    kind: ubiquitous
    statement: "The system shall locate the yt-dlp executable through a configurable path that defaults to `yt-dlp` on PATH."
    priority: must
    rationale: "Local installs differ; deployment may later need a specific binary or cookies."
```

### Error Handling Requirements

```yaml
ears_requirements:
  - id: REQ-SHADOW-400
    kind: unwanted
    if: "the submitted URL is not a recognisable YouTube video URL"
    statement: "If the submitted URL is not a recognisable YouTube video URL, then the system shall reject it with a validation error and create no record."
    priority: must
    rationale: "Fail fast before any background work."
  - id: REQ-SHADOW-401
    kind: unwanted
    if: "a video has no English captions"
    statement: "If a video has no English captions, then the system shall mark the import as failed with the reason no_captions and show that the video is not supported."
    priority: must
    rationale: "Speech recognition fallback is out of scope."
  - id: REQ-SHADOW-402
    kind: unwanted
    if: "a video does not allow embedding"
    statement: "If a video does not allow embedding, then the system shall mark the import as failed with the reason not_embeddable and show that the video is not supported."
    priority: must
    rationale: "The practice page depends on the embedded player."
  - id: REQ-SHADOW-403
    kind: unwanted
    if: "an explanation batch fails"
    statement: "If an explanation batch fails, then the system shall retry it automatically up to 3 attempts in total."
    priority: must
    rationale: "Transient endpoint errors should not require learner action."
  - id: REQ-SHADOW-404
    kind: unwanted
    if: "an explanation batch still fails after 3 attempts"
    statement: "If an explanation batch still fails after 3 attempts, then the system shall mark its sentences as failed, continue with the remaining batches, and show a regenerate action for each failed sentence."
    priority: must
    rationale: "One bad batch must not block the rest of the video."
  - id: REQ-SHADOW-405
    kind: unwanted
    if: "the LLM returns output that does not match the expected structure"
    statement: "If the LLM returns output that does not match the expected structure, then the system shall treat the attempt as failed and retry it."
    priority: must
    rationale: "Malformed output must never be stored or shown."
  - id: REQ-SHADOW-406
    kind: unwanted
    if: "caption download, metadata lookup, or segmentation fails for a reason other than missing captions or embedding"
    statement: "If caption download, metadata lookup, or segmentation fails for another reason, then the system shall mark the import as failed with the reason import_error and allow the learner to retry the import."
    priority: must
    rationale: "yt-dlp breakage and network errors must be recoverable."
  - id: REQ-SHADOW-407
    kind: unwanted
    if: "the LLM endpoint is not configured"
    statement: "If the LLM endpoint is not configured, then the system shall fail the import with a message naming the missing environment variables."
    priority: must
    rationale: "Local setup errors should be self-explanatory."
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-SHADOW-001
    statement: "Given a YouTube video with manual English captions, when the learner submits its URL, then the video reaches the ready-to-practice state with sentences whose text matches the caption wording and whose start times increase monotonically."
  - id: AC-SHADOW-002
    statement: "Given a video with only auto-generated captions, when it is imported, then its sentences have punctuation and contain no duplicated rolling-caption words."
  - id: AC-SHADOW-003
    statement: "Given a video without English captions, when the learner submits its URL, then the import fails with reason no_captions and the library shows it as not supported."
  - id: AC-SHADOW-004
    statement: "Given a video that disallows embedding, when the learner submits its URL, then the import fails with reason not_embeddable."
  - id: AC-SHADOW-005
    statement: "Given an imported video, when playback reaches the end of a segment, then the player pauses within 0.3 seconds after the segment end and the explanation panel shows the sentence's meaning, key expressions, and tone and context in Chinese."
  - id: AC-SHADOW-006
    statement: "Given the practice page is paused, when the learner presses Space, Right Arrow, Left Arrow, S, or H, then the segment replays, advances, goes back, toggles speed between 1x and 0.75x, or toggles the subtitle respectively."
  - id: AC-SHADOW-007
    statement: "Given a video whose first explanation batch is complete and later batches are pending, when the learner jumps to a sentence in a pending batch, then that batch is generated next and its explanation appears without the learner reloading the page."
  - id: AC-SHADOW-008
    statement: "Given an explanation batch that fails three times, then its sentences show a failed state with a regenerate button, and later batches still complete."
  - id: AC-SHADOW-009
    statement: "Given the learner practiced a video up to sentence N and left, when they open it from the library, then practice resumes at sentence N."
  - id: AC-SHADOW-010
    statement: "Given two users, when user B requests user A's video by id, then the API responds 404."
  - id: AC-SHADOW-011
    statement: "Given a stored explanation, when the learner revisits the sentence, then no LLM request is made."
  - id: AC-SHADOW-012
    statement: "Given a sentence longer than the segment limit, then it is practiced as several segments that each pause separately, while the explanation panel shows one explanation for the whole sentence."
```

# Non-Functional Requirements

## Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001 | Shadowing API read endpoints response time (p95, local) | < 200ms |
| NFR-002 | Time from URL submission to ready-to-practice for a 10-minute video with captions, excluding LLM latency beyond the first batch | < 90s |
| NFR-003 | Auto-pause accuracy relative to segment end plus padding | within 0.3s |
| NFR-004 | Explanation panel shows a stored explanation after segment change | < 300ms |

## Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-010 | Import workflow is idempotent per video: re-running it never duplicates sentences or explanations | Zero duplicates |
| NFR-011 | Outbox delivery of the import event | At-least-once, deduplicated by workflow id |
| NFR-012 | A failed batch does not stop the remaining batches | 100% of non-failed batches complete |

## Security

| ID | Requirement |
|----|-------------|
| NFR-020 | All shadowing endpoints validate auth tokens via the existing Effect HttpApi auth middleware |
| NFR-021 | The LLM API key is read only through a dedicated env module and never logged, returned by the API, or sent to the browser |
| NFR-022 | yt-dlp is invoked with an argument array (no shell) and only with a validated 11-character video id, preventing command injection |
| NFR-023 | All SQL goes through Drizzle parameterized queries in `packages/infra/db` |

## Observability

| ID | Requirement |
|----|-------------|
| NFR-030 | Structured logging via `@tx-agent-kit/logging` for import steps, batch outcomes, and failure reasons (no `console.*`) |
| NFR-031 | OpenTelemetry spans for caption download, segmentation, and each explanation batch |
| NFR-032 | LLM spans record model, input and output token counts, and cached token counts when the endpoint reports them |

## Data Retention

| ID | Requirement |
|----|-------------|
| NFR-040 | Shadowing data has no automatic retention policy; it is removed only when the learner deletes the video or the user |
| NFR-041 | Raw caption files are not persisted after segmentation; only sentences and segments are stored |

# Success Metrics

| Metric | Baseline | Target | Measurement Window |
|--------|----------|--------|--------------------|
| Share of submitted videos with captions that import successfully | Not measured | ≥ 95% | First 30 imports |
| Sentences whose auto-pause cuts off audible speech (learner-reported) | Manual pausing | < 5% of practiced sentences | First 10 practiced videos |
| Explanations regenerated because they were wrong or vague | Not measured | < 10% of viewed sentences | First 10 practiced videos |
| Practice sessions per week | Ad hoc | ≥ 3 | First 4 weeks |

# Risks & Mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R-001 | yt-dlp breaks when YouTube changes its interfaces | Medium | High | Configurable binary path; import fails with import_error and can be retried after upgrading yt-dlp |
| R-002 | Explanation cost grows roughly with the square of sentence count because every batch includes the full transcript and there is no length limit | Medium | Medium | Stable transcript prefix for prompt caching; batch size as a constant; token usage logged per batch so cost is visible |
| R-003 | The learner's endpoint does not support prompt caching | Medium | Medium | Same as R-002; measure real cost on a few videos before deciding on further limits |
| R-004 | Auto-caption timings produce sentence boundaries that cut words | Medium | Medium | Pause padding of ~0.2s; boundaries derived from word-level timings when available |
| R-005 | The LLM alters caption wording during segmentation | Medium | High | Validate that segmented text matches the caption words after normalisation; fail and retry otherwise |
| R-006 | Long transcripts exceed the model's context window | Low | High | Fail the batch with a clear error naming the transcript size; the learner can switch to a larger-context model |
| R-007 | YouTube blocks yt-dlp requests from cloud IPs after deployment | Low (local) | High | Out of scope for MVP; cookie support can be added through the same configuration |

# Dependencies

| Dependency | Owner | Status | Risk |
|-----------|-------|--------|------|
| yt-dlp installed on the machine running the worker | Learner | Not installed in orbs; must be installed locally | Medium |
| OpenAI-compatible LLM endpoint and API key | Learner | Available | Low |
| YouTube IFrame Player API | Google | Available | Low |
| Existing auth (users, sessions, dev-utils login) | tx-agent-kit | Implemented | Low |
| Transactional outbox and Temporal worker | tx-agent-kit | Implemented | Low |
| `compromise` NLP library for clause boundaries (MIT, npm) | spencermountain/compromise | Maintained (v14.19.0, ~1.37M weekly downloads) | Low |

# Non-goals

- Pronunciation assessment, voice recording, or speech recognition.
- A phrasebook, saved expressions, or spaced repetition.
- Auto-advance or continuous shadowing.
- Multi-tenant or public use, billing, or quotas.
- Supporting videos without English captions or videos that disallow embedding.
- Downloading or hosting video files.

# Open Questions

- [ ] Exact practice segment limit (proposed: 25 words or 8 seconds) to confirm after trying real videos.
- [ ] Explanation batch size (proposed: 20 sentences) to tune after measuring cost and latency on the learner's endpoint.
- [ ] Which model to configure, to choose after comparing explanation quality on a few real videos.
