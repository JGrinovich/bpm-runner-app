-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- TRACKS
CREATE TABLE IF NOT EXISTS tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text,
  source_filename text NOT NULL,
  mime_type text NOT NULL,
  duration_sec int,
  original_object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- TRACK_ANALYSIS (one per track for MVP)
CREATE TABLE IF NOT EXISTS track_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
  bpm numeric,
  confidence numeric,
  status text NOT NULL DEFAULT 'queued',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- RENDER_JOBS (many per track)
CREATE TABLE IF NOT EXISTS render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  target_bpm numeric NOT NULL,
  tempo_ratio numeric NOT NULL,
  preserve_pitch boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'queued',
  output_object_key text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tracks_user_created ON tracks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_render_jobs_track_created ON render_jobs(track_id, created_at DESC);

-- Optional: status constraints (keep MVP simple but safe)
ALTER TABLE track_analysis
  ADD CONSTRAINT track_analysis_status_chk
  CHECK (status IN ('queued','running','done','failed'));

ALTER TABLE render_jobs
  ADD CONSTRAINT render_jobs_status_chk
  CHECK (status IN ('queued','running','done','failed'));
