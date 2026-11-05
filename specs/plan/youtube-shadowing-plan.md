---
kind: spec
spec_type: plan
doc_id: doc-87a363b7f679
name: youtube-shadowing-plan
title: "YouTube Shadowing Practice plan"
status: draft
version: 1
owners:
  - test-olim
summary: "Implementation plan for YouTube shadowing practice: decisions, design outline, phases."
domain: shadowing
tags:
  - plan
  - youtube
  - shadowing
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-11-05
---

# Plan: YouTube Shadowing Practice

Source: grilling session in Amp thread T-01a1aa33-18d7-73d9-8b3b-2710da8481fa (2026-11-05).
PRD: `specs/prd/youtube-shadowing-prd.md`.

## Goal

A personal web tool for practicing spoken English by shadowing YouTube videos sentence by
sentence, with an LLM explaining each sentence in Chinese so the learner understands it and can
reuse its expressions later.

## Settled decisions

1. Personal tool for a single learner. No billing, quotas, or public sign-up work.
2. Practice mode: sentence-by-sentence shadowing. The player auto-pauses at the end of each
   sentence; the learner advances manually. No auto-advance, no simultaneous shadowing mode.
3. Transcript source: yt-dlp downloads English captions; manual captions first, auto-generated
   captions second. A video without English captions is rejected as unsupported. No speech
   recognition fallback.
4. Segmentation: the LLM re-segments the caption text into complete sentences once at import
   (adds punctuation, removes rolling-caption duplicates); sentence start/end times are derived
   from the original caption timings and stored. Over-long sentences are split into practice
   segments at clause boundaries; explanations still cover the whole sentence. Clause
   boundaries come from the open-source `compromise` NLP library (MIT), not the LLM, so the
   split is deterministic and free; if no clause boundary fits the limit, split at the longest
   pause between words, else keep the sentence whole.
5. No recording and no pronunciation feedback.
6. Explanation content: exactly three parts, all expanded: whole-sentence meaning (Chinese
   paraphrase), key expressions (phrases, idioms, slang, collocations), tone and context
   (why it is said, implications, register). No grammar, example sentences, or pronunciation.
7. Explanations are generated in background batches after import (~20 sentences per batch),
   each batch prompted with the full video transcript as context (prompt caching when the
   endpoint supports it). Practice can start once the first batch is ready; when the learner
   reaches a sentence whose batch is not ready, that batch is prioritised.
8. Explanations are written in Chinese; English sentences, phrases, and expressions stay in
   English.
9. Player controls: Space replays the current segment, Right Arrow next, Left Arrow previous,
   S toggles 1x / 0.75x, H toggles the English subtitle (default visible).
10. Layout: video on the left with the current sentence below it; explanation panel on the
    right, shown automatically when the segment pauses; collapsible sentence list on the side;
    clicking a sentence jumps to it.
11. Video library: home lists imported videos (title, thumbnail, duration, explanation
    progress) and remembers the last practiced sentence per video; opening a video resumes
    there. No time tracking or streaks.
12. No saved expressions / phrasebook, no spaced repetition.
13. Built inside tx-agent-kit as a new domain, following the repo's DDD, outbox, Temporal, and
    testing conventions. Existing OpenRouter module untouched.
14. LLM access: OpenAI-compatible chat completions endpoint with the learner's own API key,
    base URL, and model name (three env vars). Segmentation and explanation use the same model.
15. Runs locally first (pnpm dev on the learner's machine); deployment later. Code must not
    hard-code local assumptions so cookies for yt-dlp and deployment can be added later.
16. Data belongs to the authenticated user from the existing auth system; it is user-scoped,
    not organization- or workspace-scoped.
17. Playback: official YouTube IFrame Player API embed. Videos that disallow embedding are
    rejected as unsupported. The auto-pause point is the segment end plus ~0.2 s.
18. No video length limit. Failed explanation batches retry automatically (max 3 attempts);
    sentences that still fail show "generation failed" with a regenerate button; any
    sentence's explanation can be regenerated on demand. No manual editing.

## PRD additions (specs/prd/youtube-shadowing-prd.md)

- Requirement IDs: REQ-SHADOW-001..033 (import, explanations, practice, library),
  100..102 (auth, user scoping, 404 for other users' videos), 300..304 (OpenAI-compatible client,
  single model, stable transcript prefix for caching, outbox + Temporal, configurable yt-dlp
  path), 400..407 (invalid URL, no_captions, not_embeddable, batch retry x3, failed-sentence
  regenerate, malformed LLM output, import_error with retry, missing LLM env).
- Re-submitting an already imported video returns the existing record.
- Segmentation must keep caption wording (only punctuation, case, rolling-caption dedupe).
- Deleting a video removes its sentences, segments, explanations, and progress.
- Subtitle visibility preference is remembered.
- yt-dlp invoked without a shell, only with a validated 11-character video id; raw caption
  files are not persisted.
- NFR targets: read p95 < 200ms; ready-to-practice < 90s for a 10-minute video; auto-pause
  within 0.3s; stored explanation shown < 300ms; zero duplicates on workflow re-run.
- Open questions: segment limit (proposed 25 words / 8 s), batch size (proposed 20), model choice.

## Known risks

- Without a length limit and with the full transcript in every batch, explanation cost grows
  roughly with the square of the sentence count; worse if the endpoint lacks prompt caching.
- yt-dlp relies on unofficial YouTube interfaces and must be kept up to date.
- Auto-caption timing is word-level but noisy; derived sentence boundaries may be off by a
  fraction of a second.

## Design (specs/design/youtube-shadowing-design.md, tx 0.20.1)

- Domain `shadowing` in packages/core (events.ts, domain/, ports/, application/, adapters/);
  Context.Tag + Layer.succeed services; domain errors mapped to CoreError at the service seam.
- Tables (migration 0057_shadowing.sql): shadowing_videos (user_id FK, unique user+youtube id,
  status importing|explaining|ready|failed, failure_reason, last_segment_index),
  shadowing_sentences (explanation JSONB, explanation_status pending|ready|failed|regenerating,
  batch_index, explanation_requested_at), shadowing_segments. Cascade deletes; no retention.
  Subtitle preference in localStorage; progress on the video row (no progress table).
- API (requireAuth, user-scoped, 404 for foreign ids): POST/GET /v1/shadowing/videos,
  GET/DELETE /videos/{id}, POST /retry, PUT /progress, POST /sentences/{i}/prioritize,
  POST /sentences/{i}/regenerate.
- Events: shadowing.video_import_requested → shadowingImportWorkflow (shadowing-import-${event.id});
  shadowing.explanation_regenerate_requested → shadowingRegenerateWorkflow.
- Decision: no Temporal signals (none exist in the repo, API must not import Temporal). Batch
  priority is a DB timestamp; the workflow asks the DB for the next batch every iteration.
- Workflow: prepareShadowingTranscript (yt-dlp metadata incl. playable_in_embed + json3 captions in
  a temp dir → LLM sentence split in ~1500-word chunks → alignSentences checks words → compromise
  segments, gap fallback → replaceTranscript in one txn) → loop nextBatch / explainBatch (3 attempts)
  / markBatchFailed; video ready after batch 0 settles.
- LLM: fetch-based chatCompletionsJson in packages/infra/ai with SHADOWING_LLM_API_KEY/_BASE_URL/_MODEL;
  identical system + transcript messages per video for prompt caching; Effect Schema decode.
- Web: app/(application)/shadowing library + [videoId] practice; useYouTubeSegmentPlayer pauses at
  end + 200 ms; shortcuts Space/←/→/S/H; poll every 3 s while not ready.
- 23 invariants (INV-SHADOW-001..023), 8 failure modes, 42 verification entries.
- Tests: API routes integration, worker activities integration (fake yt-dlp script + stub
  /chat/completions server), workflow integration (real Temporal worker), two web page integration
  tests; unit/property tests for URL parsing, captions, alignment, segments, explanation, prompts,
  LLM client, dispatch, player hook.
- Implementation phases: contracts+pure domain → persistence → LLM+caption adapters → services →
  API+codegen → worker → web → quality gates + tx spec discover/fci.
