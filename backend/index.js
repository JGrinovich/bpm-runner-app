import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });
import express from "express";
import cors from "cors";
import multer from "multer";
import { createHash } from "crypto";
import { mkdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { extname } from "path";
import { v4 as uuidv4 } from "uuid";

import { initDb } from "./db.js";
import { hashPassword, checkPassword, signJWT, verifyJWT } from "./auth.js";
import { runWorkerLoop } from "./worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-me";
const PORT = process.env.PORT || 8080;
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(projectRoot, "tmp", "uploads");
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(projectRoot, "tmp", "outputs");

const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const ALLOWED_MIMES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "application/octet-stream",
]);

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// Ensure dirs exist
await mkdir(UPLOAD_DIR, { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });

const db = await initDb();
console.log("✅ SQLite connected");

const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGIN_RE.test(origin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  const token = auth.slice(7);
  const userId = verifyJWT(token, JWT_SECRET);
  if (!userId) {
    return res.status(401).json({ error: "invalid token" });
  }
  req.userId = userId;
  next();
}

// Health
app.get("/healthz", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.status(200).send("ok");
  } catch {
    res.status(503).send("db not ready");
  }
});

// Auth
app.post("/api/auth/signup", async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("method not allowed");
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }
  const normEmail = String(email).trim().toLowerCase();
  try {
    const hash = await hashPassword(password);
    const id = uuidv4();
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)"
    ).run(id, normEmail, hash);
    const token = signJWT(id, JWT_SECRET);
    res.status(201).json({ ok: true, token });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(400).json({ error: "could not create user" });
    }
    res.status(500).json({ error: "failed to hash password" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const normEmail = String(email || "").trim().toLowerCase();
  if (!normEmail || !password) {
    return res.status(400).json({ error: "email/password required" });
  }
  const row = db
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .get(normEmail);
  if (!row || !(await checkPassword(row.password_hash, password))) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  const token = signJWT(row.id, JWT_SECRET);
  res.json({ token });
});

// Me
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user_id: req.userId });
});

// Tracks list & create
app
  .route("/api/tracks")
  .all(authMiddleware)
  .get((req, res) => {
    const rows = db
      .prepare(
        `SELECT id, title, source_filename, mime_type, duration_sec, original_object_key, created_at
         FROM tracks WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(req.userId);
    const out = rows.map((r) => ({
      id: r.id,
      title: r.title,
      source_filename: r.source_filename,
      mime_type: r.mime_type,
      duration_sec: r.duration_sec,
      original_object_key: r.original_object_key,
      created_at: r.created_at,
    }));
    res.json(out);
  })
  .post((req, res) => {
    const { source_filename, mime_type, original_object_key, title, duration_sec } =
      req.body || {};
    if (!source_filename || !mime_type || !original_object_key) {
      return res
        .status(400)
        .json({ error: "source_filename, mime_type, original_object_key required" });
    }
    const id = uuidv4();
    db.prepare(
      `INSERT INTO tracks (id, user_id, title, source_filename, mime_type, duration_sec, original_object_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.userId, title ?? null, source_filename, mime_type, duration_sec ?? null, original_object_key);
    res.status(201).json({ id });
  });

// Track upload (multipart)
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    if (ALLOWED_MIMES.has(mime) || mime === "application/octet-stream") {
      cb(null, true);
    } else {
      cb(new Error(`unsupported mime: ${mime}`));
    }
  },
});

app.post("/api/tracks/upload", authMiddleware, (req, res, next) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "file too large" });
      }
      return res.status(400).json({ error: err.message || "upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "missing form file field 'file'" });
    }

    const ext = extname(req.file.originalname) || ".bin";
    const objKey = uuidv4() + ext.toLowerCase();
    const dstPath = join(UPLOAD_DIR, objKey);

    const { renameSync } = await import("fs");
    renameSync(req.file.path, dstPath);

    const { createReadStream } = await import("fs");
    const hasher = createHash("sha256");
    const stream = createReadStream(dstPath);
    for await (const chunk of stream) {
      hasher.update(chunk);
    }
    const hashHex = hasher.digest("hex");

    const title = req.file.originalname;
    const mimeType = (req.file.mimetype || "application/octet-stream").toLowerCase();

    try {
      const id = uuidv4();
      db.prepare(
        `INSERT INTO tracks (id, user_id, title, source_filename, mime_type, duration_sec, original_object_key)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      ).run(id, req.userId, title, req.file.originalname, mimeType, dstPath);
      res.status(201).json({
        id,
        stored_bytes: req.file.size,
        original_object_key: dstPath,
        sha256: hashHex,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      const { unlinkSync } = await import("fs");
      try {
        unlinkSync(dstPath);
      } catch {}
      res.status(500).json({ error: "db insert failed" });
    }
  });
});

function ensureTrackOwnership(userId, trackId) {
  const row = db
    .prepare("SELECT 1 FROM tracks WHERE id = ? AND user_id = ?")
    .get(trackId, userId);
  return !!row;
}

// GET /api/tracks/:id
app.get("/api/tracks/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!ensureTrackOwnership(req.userId, id)) {
    return res.status(404).json({ error: "not found" });
  }
  const track = db
    .prepare(
      `SELECT id, title, source_filename, mime_type, duration_sec, original_object_key, created_at
       FROM tracks WHERE id = ?`
    )
    .get(id);
  if (!track) return res.status(404).json({ error: "not found" });

  const analysis = db
    .prepare(
      `SELECT id, bpm, confidence, status, error_message, finished_at
       FROM track_analysis WHERE track_id = ?`
    )
    .get(id);

  const latestRender = db
    .prepare(
      `SELECT id, target_bpm, status, output_object_key
       FROM render_jobs WHERE track_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(id);

  res.json({
    track: {
      id: track.id,
      title: track.title,
      source_filename: track.source_filename,
      mime_type: track.mime_type,
      duration_sec: track.duration_sec,
      original_object_key: track.original_object_key,
      created_at: track.created_at,
    },
    analysis: analysis
      ? {
          id: analysis.id,
          bpm: analysis.bpm,
          confidence: analysis.confidence,
          status: analysis.status,
          error: analysis.error_message,
          finished_at: analysis.finished_at,
        }
      : null,
    latest_render: latestRender
      ? {
          id: latestRender.id,
          target_bpm: latestRender.target_bpm,
          status: latestRender.status,
          output_object_key: latestRender.output_object_key,
        }
      : null,
  });
});

// POST /api/tracks/:id/analyze
app.post("/api/tracks/:id/analyze", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!ensureTrackOwnership(req.userId, id)) {
    return res.status(404).json({ error: "not found" });
  }
  const analysisId = uuidv4();
  db.prepare(
    `INSERT INTO track_analysis (id, track_id, status)
     VALUES (?, ?, 'queued')
     ON CONFLICT (track_id) DO UPDATE SET
       status = 'queued',
       error_message = NULL,
       bpm = NULL,
       confidence = NULL,
       created_at = datetime('now'),
       finished_at = NULL`
  ).run(analysisId, id);
  res.status(202).json({ track_id: id, status: "queued" });
});

// GET /api/tracks/:id/analysis
app.get("/api/tracks/:id/analysis", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!ensureTrackOwnership(req.userId, id)) {
    return res.status(404).json({ error: "not found" });
  }
  const row = db
    .prepare(
      `SELECT id, bpm, confidence, status, error_message, created_at, finished_at
       FROM track_analysis WHERE track_id = ?`
    )
    .get(id);
  if (!row) return res.status(404).json({ error: "no analysis" });
  res.json({
    id: row.id,
    track_id: id,
    bpm: row.bpm,
    confidence: row.confidence,
    status: row.status,
    error: row.error_message,
    created_at: row.created_at,
    finished_at: row.finished_at,
  });
});

// POST /api/tracks/:id/render
app.post("/api/tracks/:id/render", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!ensureTrackOwnership(req.userId, id)) {
    return res.status(404).json({ error: "not found" });
  }
  const { target_bpm = 0, preserve_pitch = true } = req.body || {};
  if (target_bpm < 40 || target_bpm > 260) {
    return res.status(400).json({ error: "target_bpm out of range" });
  }
  const renderId = uuidv4();
  db.prepare(
    `INSERT INTO render_jobs (id, track_id, target_bpm, tempo_ratio, preserve_pitch, status)
     VALUES (?, ?, ?, 1.0, ?, 'queued')`
  ).run(renderId, id, target_bpm, preserve_pitch ? 1 : 0);
  res.status(202).json({ render_id: renderId, status: "queued" });
});

// GET /api/renders/:id
app.get("/api/renders/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const row = db
    .prepare(
      `SELECT r.id, r.track_id, r.target_bpm, r.tempo_ratio, r.preserve_pitch, r.status,
              r.output_object_key, r.error_message, r.created_at, r.finished_at
       FROM render_jobs r
       JOIN tracks t ON t.id = r.track_id
       WHERE r.id = ? AND t.user_id = ?`
    )
    .get(id, req.userId);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({
    id: row.id,
    track_id: row.track_id,
    target_bpm: row.target_bpm,
    tempo_ratio: row.tempo_ratio,
    preserve_pitch: !!row.preserve_pitch,
    status: row.status,
    output_object_key: row.output_object_key,
    error: row.error_message,
    created_at: row.created_at,
    finished_at: row.finished_at,
  });
});

// GET /api/render-files/:id
app.get("/api/render-files/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const row = db
    .prepare(
      `SELECT r.output_object_key, r.status
       FROM render_jobs r
       JOIN tracks t ON t.id = r.track_id
       WHERE r.id = ? AND t.user_id = ?`
    )
    .get(id, req.userId);
  if (!row) return res.status(404).json({ error: "not found" });
  if (row.status !== "done" || !row.output_object_key) {
    return res.status(409).json({ error: "render not ready" });
  }
  stat(row.output_object_key).then(
    () => {
      res.setHeader("Content-Type", "audio/mpeg");
      createReadStream(row.output_object_key).pipe(res);
    },
    () => res.status(500).json({ error: "file missing on server" })
  );
});

// Stub
app.post("/api/uploads/signed-url", authMiddleware, (req, res) => {
  res.status(501).json({
    message: "signed-url not implemented in Phase 1 (use local upload in Phase 3)",
  });
});

// Run worker loop in background
runWorkerLoop(db, UPLOAD_DIR, OUTPUT_DIR);

app.listen(PORT, () => {
  console.log(`🚀 backend listening on :${PORT}`);
});
