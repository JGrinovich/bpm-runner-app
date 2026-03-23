import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DATABASE_PATH || join(__dirname, "..", "data", "bpm.db");

export function initDb() {
  const db = new Database(dbPath);

  db.exec(`
    -- USERS
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- TRACKS
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      source_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      duration_sec INTEGER,
      original_object_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- TRACK_ANALYSIS
    CREATE TABLE IF NOT EXISTS track_analysis (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
      bpm REAL,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'queued',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      CHECK (status IN ('queued','running','done','failed'))
    );

    -- RENDER_JOBS
    CREATE TABLE IF NOT EXISTS render_jobs (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      target_bpm REAL NOT NULL,
      tempo_ratio REAL,
      preserve_pitch INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'queued',
      output_object_key TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      CHECK (status IN ('queued','running','done','failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_user_created ON tracks(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_render_jobs_track_created ON render_jobs(track_id, created_at DESC);
  `);

  return db;
}
