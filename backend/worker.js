import { spawn } from "child_process";
import { mkdtemp, mkdir, stat, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { v4 as uuidv4 } from "uuid";

function runCmd(name, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(name, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${name} ${args.join(" ")}: exit ${code}\n${stderr}`));
    });
    proc.on("error", (err) => {
      if (err && err.code === "ENOENT") {
        reject(
          new Error(
            `Missing required binary: '${name}'. Install it and restart backend.`
          )
        );
        return;
      }
      reject(err);
    });
  });
}

async function checkDependencies() {
  await runCmd("ffmpeg", ["-version"]);
  await runCmd("aubio", ["--help"]);
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return 0;
  if (n % 2) return a[(n - 1) / 2];
  return (a[n / 2 - 1] + a[n / 2]) / 2;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

async function aubioTempoBPM(wavPath) {
  const out = await runCmd("aubio", ["tempo", "-i", wavPath]);
  const s = out.toLowerCase().replace(/bpm/g, "").trim();
  const fields = s.split(/\s+/);
  if (!fields.length) throw new Error("aubio tempo returned empty");
  const v = parseFloat(fields[0]);
  if (isNaN(v)) throw new Error(`failed to parse aubio tempo: ${fields[0]}`);
  return v;
}

async function aubioBeatTimes(wavPath) {
  const out = await runCmd("aubio", ["beat", "-i", wavPath]);
  const beats = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^([\d.]+)/);
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 0) beats.push(v);
    }
  }
  return beats;
}

function bpmFromBeats(beats) {
  if (beats.length < 8) return null;
  const intervals = [];
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1];
    if (d > 0.2 && d < 2.0) intervals.push(d);
  }
  if (intervals.length < 6) return null;
  const med = median(intervals);
  if (med <= 0) return null;
  const bpm = 60 / med;
  const absDev = intervals.map((d) => Math.abs(d - med)).sort((a, b) => a - b);
  const mad = median(absDev);
  const confidence = clamp(1 - mad / med, 0, 1);
  return { bpm, confidence };
}

function resolveTempo(raw) {
  return [raw, raw * 2, raw * 0.5];
}

function chooseBestTempo(beatBpm, beatConf, tempoBpm) {
  const cands = resolveTempo(beatBpm);
  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    let score = Math.abs(c - tempoBpm);
    if (c < 60 || c > 220) score += 50;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  let conf = beatConf;
  if (Math.abs(best - beatBpm) > 5) conf *= 0.75;
  return [best, clamp(conf, 0, 1)];
}

function buildAtempoChain(ratio) {
  if (ratio <= 0) throw new Error(`invalid ratio: ${ratio}`);
  const factors = [];
  let r = ratio;
  while (r > 2) {
    factors.push(2);
    r /= 2;
  }
  while (r < 0.5) {
    factors.push(0.5);
    r /= 0.5;
  }
  factors.push(r);
  return factors.map((f) => `atempo=${f.toFixed(6)}`).join(",");
}

async function runAnalysisJob(db, analysisId, trackId, uploadDir) {
  const row = db.prepare("SELECT original_object_key FROM tracks WHERE id = ?").get(trackId);
  if (!row) throw new Error("track not found");
  const srcPath = row.original_object_key;

  await stat(srcPath);

  const tmpDir = await mkdtemp(join(tmpdir(), "bpmworker-"));
  const workingWav = join(tmpDir, "working.wav");

  try {
    await runCmd("ffmpeg", [
      "-y", "-ss", "45", "-t", "90",
      "-i", srcPath,
      "-ac", "1", "-ar", "44100",
      workingWav,
    ]);

    const tempoBpm = await aubioTempoBPM(workingWav);
    const beats = await aubioBeatTimes(workingWav);
    const beatResult = bpmFromBeats(beats);
    if (!beatResult) throw new Error("not enough beat events to estimate BPM");

    const [chosen, conf] = chooseBestTempo(beatResult.bpm, beatResult.confidence, tempoBpm);
    const finalBpm = clamp(chosen, 60, 220);
    const finalConf = Math.abs(finalBpm - chosen) > 0.1 ? conf * 0.7 : conf;

    db.prepare(`
      UPDATE track_analysis
      SET bpm = ?, confidence = ?, status = 'done', error_message = NULL, finished_at = datetime('now')
      WHERE id = ?
    `).run(finalBpm, clamp(finalConf, 0, 1), analysisId);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function runRenderJob(db, renderId, trackId, targetBpm, outputDir) {
  const trackRow = db.prepare("SELECT original_object_key FROM tracks WHERE id = ?").get(trackId);
  if (!trackRow) throw new Error("track lookup failed");
  const srcPath = trackRow.original_object_key;
  await stat(srcPath);

  const analysisRow = db.prepare("SELECT bpm, status FROM track_analysis WHERE track_id = ?").get(trackId);
  if (!analysisRow || analysisRow.status !== "done") throw new Error("analysis not done");
  const detectedBpm = analysisRow.bpm;
  if (!detectedBpm || detectedBpm <= 0) throw new Error(`invalid detected bpm: ${detectedBpm}`);

  const ratio = targetBpm / detectedBpm;
  const chain = buildAtempoChain(ratio);

  const tmpDir = await mkdtemp(join(tmpdir(), "render-"));
  const workingWav = join(tmpDir, "working.wav");

  try {
    await runCmd("ffmpeg", ["-y", "-i", srcPath, "-ac", "1", "-ar", "44100", workingWav]);

    const outKey = `${uuidv4()}.mp3`;
    const outPath = join(outputDir, outKey);

    await runCmd("ffmpeg", [
      "-y", "-i", workingWav,
      "-filter:a", chain,
      "-codec:a", "libmp3lame", "-q:a", "2",
      outPath,
    ]);

    db.prepare(`
      UPDATE render_jobs
      SET tempo_ratio = ?, output_object_key = ?, status = 'done', error_message = NULL, finished_at = datetime('now')
      WHERE id = ?
    `).run(ratio, outPath, renderId);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function claimAnalysisJob(db) {
  return db.transaction(() => {
    const row = db.prepare(
      "SELECT id, track_id FROM track_analysis WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
    ).get();
    if (!row) return null;
    const r = db.prepare(
      "UPDATE track_analysis SET status = 'running', error_message = NULL WHERE id = ?"
    ).run(row.id);
    return r.changes > 0 ? row : null;
  })();
}

function claimRenderJob(db) {
  return db.transaction(() => {
    const row = db.prepare(
      "SELECT id, track_id, target_bpm, preserve_pitch FROM render_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
    ).get();
    if (!row) return null;
    const r = db.prepare(
      "UPDATE render_jobs SET status = 'running', error_message = NULL WHERE id = ?"
    ).run(row.id);
    return r.changes > 0 ? row : null;
  })();
}

export function runWorkerLoop(db, uploadDir, outputDir) {
  const poll = async () => {
    try {
      const analysis = claimAnalysisJob(db);
      if (analysis) {
        console.log(`[worker] claimed analysis ${analysis.id} track=${analysis.track_id}`);
        try {
          await runAnalysisJob(db, analysis.id, analysis.track_id, uploadDir);
          console.log(`[worker] analysis done ${analysis.id}`);
        } catch (err) {
          const msg = String(err.message).slice(0, 500);
          db.prepare(`
            UPDATE track_analysis SET status = 'failed', error_message = ?, finished_at = datetime('now')
            WHERE id = ?
          `).run(msg, analysis.id);
          console.error(`[worker] analysis failed ${analysis.id}:`, err.message);
        }
        setTimeout(poll, 100);
        return;
      }

      const render = claimRenderJob(db);
      if (render) {
        console.log(`[worker] claimed render ${render.id} track=${render.track_id} target=${render.target_bpm}`);
        try {
          await runRenderJob(db, render.id, render.track_id, render.target_bpm, outputDir);
          console.log(`[worker] render done ${render.id}`);
        } catch (err) {
          const msg = String(err.message).slice(0, 500);
          db.prepare(`
            UPDATE render_jobs SET status = 'failed', error_message = ?, finished_at = datetime('now')
            WHERE id = ?
          `).run(msg, render.id);
          console.error(`[worker] render failed ${render.id}:`, err.message);
        }
        setTimeout(poll, 100);
        return;
      }
    } catch (err) {
      console.error("[worker] poll error:", err.message);
    }
    setTimeout(poll, 2000);
  };
  checkDependencies()
    .then(() => {
      console.log("[worker] dependencies ready (ffmpeg, aubio)");
      setTimeout(poll, 1000);
    })
    .catch((err) => {
      console.error(`[worker] startup blocked: ${err.message}`);
    });
}
