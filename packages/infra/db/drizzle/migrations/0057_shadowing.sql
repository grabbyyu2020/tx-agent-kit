-- YouTube shadowing practice (specs/design/youtube-shadowing-design.md §"Data Model").
--
-- shadowing_videos: one row per (user, YouTube id); resume position lives on the
-- row (Decision 4). shadowing_sentences / shadowing_segments are derived from the
-- captions and replaced in one transaction by the import workflow (INV-SHADOW-023);
-- both cascade with the video (INV-SHADOW-017) and the user.
--
-- Sentence explanation consistency (INV-SHADOW-012):
--   ready        => explanation IS NOT NULL
--   pending      => explanation IS NULL
--   failed       => explanation may or may not be present (a failed regeneration
--                   keeps the previous explanation)
--   regenerating => explanation may or may not be present (keeps the old one
--                   until the regeneration finishes)
--
-- Operational learner data: NOT added to retention policies (NFR-040).
-- Objects are created in current_schema (no public.* qualification) so
-- per-schema integration suites stay isolated.

CREATE TABLE IF NOT EXISTS shadowing_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL CONSTRAINT shadowing_videos_youtube_video_id_format CHECK (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  caption_kind TEXT CONSTRAINT shadowing_videos_caption_kind_check CHECK (caption_kind IN ('manual', 'auto')),
  status TEXT NOT NULL DEFAULT 'importing' CONSTRAINT shadowing_videos_status_check CHECK (status IN ('importing', 'explaining', 'ready', 'failed')),
  failure_reason TEXT CONSTRAINT shadowing_videos_failure_reason_check CHECK (failure_reason IN ('no_captions', 'not_embeddable', 'import_error')),
  failure_message TEXT,
  sentence_count INTEGER NOT NULL DEFAULT 0,
  last_segment_index INTEGER NOT NULL DEFAULT 0 CONSTRAINT shadowing_videos_last_segment_index_check CHECK (last_segment_index >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shadowing_videos_failure_consistency CHECK ((status = 'failed') = (failure_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS shadowing_videos_user_youtube_unique
  ON shadowing_videos (user_id, youtube_video_id);

-- Library listing: newest first per user.
CREATE INDEX IF NOT EXISTS shadowing_videos_user_created_idx
  ON shadowing_videos (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shadowing_sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES shadowing_videos(id) ON DELETE CASCADE,
  sentence_index INTEGER NOT NULL CONSTRAINT shadowing_sentences_sentence_index_check CHECK (sentence_index >= 0),
  batch_index INTEGER NOT NULL CONSTRAINT shadowing_sentences_batch_index_check CHECK (batch_index >= 0),
  text TEXT NOT NULL,
  start_ms INTEGER NOT NULL CONSTRAINT shadowing_sentences_start_ms_check CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL,
  explanation JSONB,
  explanation_status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT shadowing_sentences_explanation_status_check CHECK (explanation_status IN ('pending', 'ready', 'failed', 'regenerating')),
  explanation_requested_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shadowing_sentences_end_after_start CHECK (end_ms >= start_ms),
  CONSTRAINT shadowing_sentences_explanation_consistency CHECK (
    (explanation_status <> 'ready' OR explanation IS NOT NULL)
    AND (explanation_status <> 'pending' OR explanation IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS shadowing_sentences_video_index_unique
  ON shadowing_sentences (video_id, sentence_index);

-- Next-batch selection: pending sentences of a video by batch.
CREATE INDEX IF NOT EXISTS shadowing_sentences_pending_idx
  ON shadowing_sentences (video_id, explanation_status, batch_index);

CREATE TABLE IF NOT EXISTS shadowing_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES shadowing_videos(id) ON DELETE CASCADE,
  sentence_id UUID NOT NULL REFERENCES shadowing_sentences(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL CONSTRAINT shadowing_segments_segment_index_check CHECK (segment_index >= 0),
  sentence_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_ms INTEGER NOT NULL CONSTRAINT shadowing_segments_start_ms_check CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL,
  CONSTRAINT shadowing_segments_end_after_start CHECK (end_ms >= start_ms)
);

CREATE UNIQUE INDEX IF NOT EXISTS shadowing_segments_video_index_unique
  ON shadowing_segments (video_id, segment_index);
