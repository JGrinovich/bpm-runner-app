package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JGrinovich/bpm-runner-app/worker/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if os.Getenv("WORKER_DISABLED") == "1" {
		log.Println("🛑 worker disabled via WORKER_DISABLED=1")
		return
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	// R2 env
	r2AccountID := os.Getenv("R2_ACCOUNT_ID")
	r2AccessKey := os.Getenv("R2_ACCESS_KEY_ID")
	r2SecretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	r2Bucket := os.Getenv("R2_BUCKET")
	if r2AccountID == "" || r2AccessKey == "" || r2SecretKey == "" || r2Bucket == "" {
		log.Fatal("R2 env vars required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET")
	}

	// Use a short timeout ONLY for startup connectivity checks
	startupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(startupCtx, dbURL)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(startupCtx); err != nil {
		log.Fatalf("db ping failed: %v", err)
	}
	log.Println("✅ worker connected to postgres")

	// R2 client init
	r2AccountID := os.Getenv("R2_ACCOUNT_ID")
	r2AccessKey := os.Getenv("R2_ACCESS_KEY_ID")
	r2SecretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	r2Bucket := os.Getenv("R2_BUCKET")
	if r2AccountID == "" || r2AccessKey == "" || r2SecretKey == "" || r2Bucket == "" {
		log.Fatal("R2 env vars required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET")
	}

	r2c, err := storage.NewR2Client(ctx, r2AccountID, r2AccessKey, r2SecretKey, r2Bucket)
	if err != nil {
		log.Fatalf("r2 init failed: %v", err)
	}
	log.Printf("🪣 worker R2 bucket: %s\n", r2Bucket)

	for {
		// Always use a fresh background ctx for claim queries (don’t reuse startup ctx)
		baseCtx := context.Background()

		// 1) Try analysis first
		claimedA, analysisID, trackID, err := claimNextAnalysisJob(baseCtx, pool)
		if err != nil {
			log.Printf("analysis claim error: %v\n", err)
			time.Sleep(2 * time.Second)
			continue
		}

		if claimedA {
			log.Printf("🔎 claimed analysis job id=%s track=%s\n", analysisID, trackID)

<<<<<<< HEAD
			jobCtx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
			err = runAnalysisJob(jobCtx, pool, r2c, analysisID, trackID)
			cancel()

=======
			err = runAnalysisJob(context.Background(), pool, r2c, analysisID, trackID)
>>>>>>> b0beeab (temp commit before rebase)
			if err != nil {
				log.Printf("❌ analysis failed id=%s track=%s err=%v\n", analysisID, trackID, err)
				_ = markAnalysisFailed(context.Background(), pool, analysisID, err.Error())
			} else {
				log.Printf("✅ analysis done id=%s track=%s\n", analysisID, trackID)
			}

			// keep draining analysis queue first
			continue
		}

		// 2) Try render
		claimedR, renderID, trackIDR, targetBpm, preservePitch, err := claimNextRenderJob(baseCtx, pool)
		if err != nil {
			log.Printf("render claim error: %v\n", err)
			time.Sleep(2 * time.Second)
			continue
		}

		if claimedR {
			log.Printf("🎛️ claimed render job id=%s track=%s target=%.2f preserve_pitch=%v\n",
				renderID, trackIDR, targetBpm, preservePitch)

			jobCtx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
			err := runRenderJob(jobCtx, pool, r2c, renderID, trackIDR, targetBpm)
			cancel()

			if err != nil {
				log.Printf("❌ render failed id=%s err=%v\n", renderID, err)
				_ = markRenderFailed(context.Background(), pool, renderID, err.Error())
			} else {
				log.Printf("✅ render done id=%s\n", renderID)
			}
			continue
		}

		// 3) nothing to do
		time.Sleep(2 * time.Second)
	}
}

func claimNextAnalysisJob(ctx context.Context, pool *pgxpool.Pool) (bool, string, string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var analysisID, trackID string
	err = tx.QueryRow(ctx, `
WITH cte AS (
  SELECT id, track_id
  FROM track_analysis
  WHERE status='queued'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE track_analysis ta
SET status='running', error_message=NULL
FROM cte
WHERE ta.id = cte.id
RETURNING ta.id, ta.track_id;
`).Scan(&analysisID, &trackID)

	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			_ = tx.Commit(ctx)
			return false, "", "", nil
		}
		return false, "", "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, "", "", err
	}
	return true, analysisID, trackID, nil
}

func runAnalysisJob(ctx context.Context, pool *pgxpool.Pool, r2c *storage.R2Client, analysisID, trackID string) error {
<<<<<<< HEAD
	// NOTE: this is now an R2 object key (e.g. uploads/xyz.mp3)
	var srcKey string
	if err := pool.QueryRow(ctx, `SELECT original_object_key FROM tracks WHERE id=$1`, trackID).Scan(&srcKey); err != nil {
=======
	// Get R2 object key from tracks
	var srcKey string
	err := pool.QueryRow(ctx, `SELECT original_object_key FROM tracks WHERE id=$1`, trackID).Scan(&srcKey)
	if err != nil {
>>>>>>> b0beeab (temp commit before rebase)
		return fmt.Errorf("track not found: %w", err)
	}

	tmpDir, err := os.MkdirTemp("", "bpmworker-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

<<<<<<< HEAD
	inputPath := filepath.Join(tmpDir, "input.bin")
	if err := r2c.DownloadToFile(ctx, srcKey, inputPath); err != nil {
		return err
	}

	workingWav := filepath.Join(tmpDir, "working.wav")

	// Convert to consistent WAV (sample a middle chunk for BPM stability)
	if err := runCmd(ctx, "ffmpeg", "-y",
		"-ss", "45", "-t", "90",
		"-i", inputPath,
=======
	// Download from R2 to temp file
	inputPath := filepath.Join(tmpDir, "input.bin")
	if err := r2c.DownloadToFile(ctx, srcKey, inputPath); err != nil {
		return fmt.Errorf("failed to download from R2: %w", err)
	}

	workingWav := filepath.Join(tmpDir, "working.wav")
	// 1) Convert to consistent WAV
	if err := runCmd(ctx, "ffmpeg", "-y",
		"-ss", "45", "-t", "90",
		"-i", inputPath, // Use downloaded file
>>>>>>> b0beeab (temp commit before rebase)
		"-ac", "1", "-ar", "44100",
		workingWav,
	); err != nil {
		return fmt.Errorf("ffmpeg convert failed: %w", err)
	}

	tempoBpm, err := aubioTempoBPM(ctx, workingWav)
	if err != nil {
		return err
	}

	beats, err := aubioBeatTimes(ctx, workingWav)
	if err != nil {
		return err
	}

	beatBpm, beatConf, ok := bpmAndConfidenceFromBeats(beats)
	if !ok {
		return errors.New("not enough beat events detected to estimate BPM")
	}

	chosen, conf := chooseBestTempo(beatBpm, beatConf, tempoBpm)

	// Clamp final BPM
	finalBpm := clamp(chosen, 60, 220)
	if math.Abs(finalBpm-chosen) > 0.1 {
		conf *= 0.7
		conf = clamp(conf, 0, 1)
	}

	_, err = pool.Exec(ctx, `
UPDATE track_analysis
SET bpm=$1,
    confidence=$2,
    status='done',
    error_message=NULL,
    finished_at=now()
WHERE id=$3;
`, finalBpm, conf, analysisID)

	return err
}

func markAnalysisFailed(ctx context.Context, pool *pgxpool.Pool, analysisID, msg string) error {
	if len(msg) > 500 {
		msg = msg[:500]
	}
	_, err := pool.Exec(ctx, `
UPDATE track_analysis
SET status='failed',
    error_message=$1,
    finished_at=now()
WHERE id=$2;
`, msg, analysisID)
	return err
}

func claimNextRenderJob(ctx context.Context, pool *pgxpool.Pool) (bool, string, string, float64, bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, "", "", 0, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var jobID, trackID string
	var targetBpm float64
	var preservePitch bool

	err = tx.QueryRow(ctx, `
WITH cte AS (
  SELECT id, track_id, target_bpm, preserve_pitch
  FROM render_jobs
  WHERE status='queued'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE render_jobs r
SET status='running', error_message=NULL
FROM cte
WHERE r.id = cte.id
RETURNING r.id, r.track_id, r.target_bpm, r.preserve_pitch;
`).Scan(&jobID, &trackID, &targetBpm, &preservePitch)

	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			_ = tx.Commit(ctx)
			return false, "", "", 0, false, nil
		}
		return false, "", "", 0, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, "", "", 0, false, err
	}
	return true, jobID, trackID, targetBpm, preservePitch, nil
}

func markRenderFailed(ctx context.Context, pool *pgxpool.Pool, renderID, msg string) error {
	if len(msg) > 500 {
		msg = msg[:500]
	}
	_, err := pool.Exec(ctx, `
UPDATE render_jobs
SET status='failed',
    error_message=$1,
    finished_at=now()
WHERE id=$2;
`, msg, renderID)
	return err
}

func buildAtempoChain(ratio float64) (string, error) {
	if ratio <= 0 {
		return "", fmt.Errorf("invalid ratio: %v", ratio)
	}

	factors := []float64{}
	r := ratio

	for r > 2.0 {
		factors = append(factors, 2.0)
		r /= 2.0
	}
	for r < 0.5 {
		factors = append(factors, 0.5)
		r /= 0.5
	}
	factors = append(factors, r)

	parts := make([]string, 0, len(factors))
	for _, f := range factors {
		parts = append(parts, fmt.Sprintf("atempo=%.6f", f))
	}
	return strings.Join(parts, ","), nil
}

func runRenderJob(ctx context.Context, pool *pgxpool.Pool, r2c *storage.R2Client, renderID, trackID string, targetBpm float64) error {
	// Input key from tracks (R2 key)
	var srcKey string
	if err := pool.QueryRow(ctx, `SELECT original_object_key FROM tracks WHERE id=$1`, trackID).Scan(&srcKey); err != nil {
		return fmt.Errorf("track not found: %w", err)
	}

	// Analysis must be done
	var detectedBpm float64
	var aStatus string
	if err := pool.QueryRow(ctx, `SELECT bpm, status FROM track_analysis WHERE track_id=$1`, trackID).Scan(&detectedBpm, &aStatus); err != nil {
		return fmt.Errorf("missing analysis: %w", err)
	}
	if aStatus != "done" || detectedBpm <= 0 {
		return fmt.Errorf("analysis not ready (status=%s bpm=%v)", aStatus, detectedBpm)
	}

	ratio := targetBpm / detectedBpm
	chain, err := buildAtempoChain(ratio)
	if err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "render-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	inputPath := filepath.Join(tmpDir, "input.bin")
	if err := r2c.DownloadToFile(ctx, srcKey, inputPath); err != nil {
		return err
	}

	workingWav := filepath.Join(tmpDir, "working.wav")
	if err := runCmd(ctx, "ffmpeg", "-y", "-i", inputPath, "-ac", "1", "-ar", "44100", workingWav); err != nil {
		return fmt.Errorf("ffmpeg wav convert failed: %w", err)
	}

	outLocal := filepath.Join(tmpDir, "out.mp3")
	if err := runCmd(ctx, "ffmpeg", "-y", "-i", workingWav, "-filter:a", chain, "-codec:a", "libmp3lame", "-q:a", "2", outLocal); err != nil {
		return fmt.Errorf("ffmpeg render failed: %w", err)
	}

	outKey := fmt.Sprintf("renders/%s.mp3", uuid.New().String())
	if err := r2c.UploadFromFile(ctx, outKey, outLocal, "audio/mpeg"); err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
UPDATE render_jobs
SET tempo_ratio=$1,
    output_object_key=$2,
    status='done',
    error_message=NULL,
    finished_at=now()
WHERE id=$3;
`, ratio, outKey, renderID)

	return err
}

func runCmd(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %w\n%s", name, args, err, string(out))
	}
	return nil
}

func aubioBeatTimes(ctx context.Context, wavPath string) ([]float64, error) {
	cmd := exec.CommandContext(ctx, "aubio", "beat", "-i", wavPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("aubio beat failed: %w\n%s", err, string(out))
	}

	lines := strings.Split(string(out), "\n")
	var beats []float64
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		v, err := strconv.ParseFloat(fields[0], 64)
		if err == nil && v > 0 {
			beats = append(beats, v)
		}
	}
	return beats, nil
}

func bpmAndConfidenceFromBeats(beats []float64) (bpm float64, confidence float64, ok bool) {
	if len(beats) < 8 {
		return 0, 0, false
	}

	var intervals []float64
	for i := 1; i < len(beats); i++ {
		d := beats[i] - beats[i-1]
		if d > 0.2 && d < 2.0 {
			intervals = append(intervals, d)
		}
	}
	if len(intervals) < 6 {
		return 0, 0, false
	}

	sort.Float64s(intervals)
	med := median(intervals)
	if med <= 0 {
		return 0, 0, false
	}
	bpm = 60.0 / med

	var absDev []float64
	for _, d := range intervals {
		absDev = append(absDev, math.Abs(d-med))
	}
	sort.Float64s(absDev)
	mad := median(absDev)

	confidence = 1.0 - (mad / med)
	confidence = clamp(confidence, 0, 1)

	return bpm, confidence, true
}

func aubioTempoBPM(ctx context.Context, wavPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, "aubio", "tempo", "-i", wavPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("aubio tempo failed: %w\n%s", err, string(out))
	}

	s := strings.ToLower(strings.TrimSpace(string(out)))
	s = strings.ReplaceAll(s, "bpm", "")
	s = strings.TrimSpace(s)

	fields := strings.Fields(s)
	if len(fields) == 0 {
		return 0, fmt.Errorf("aubio tempo returned empty output: %q", string(out))
	}

	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, fmt.Errorf("failed parsing aubio tempo output %q: %w", fields[0], err)
	}
	return v, nil
}

func resolveTempo(raw float64) []float64 {
	return []float64{raw, raw * 2.0, raw * 0.5}
}

func chooseBestTempo(beatBpm float64, beatConf float64, tempoBpm float64) (chosenBpm float64, chosenConf float64) {
	cands := resolveTempo(beatBpm)

	best := cands[0]
	bestScore := math.Inf(1)

	for _, c := range cands {
		score := math.Abs(c - tempoBpm)
		if c < 60 || c > 220 {
			score += 50
		}
		if score < bestScore {
			bestScore = score
			best = c
		}
	}

	conf := beatConf
	if math.Abs(best-beatBpm) > 5 {
		conf *= 0.75
	}

	return best, clamp(conf, 0, 1)
}

func median(a []float64) float64 {
	n := len(a)
	if n == 0 {
		return 0
	}
	if n%2 == 1 {
		return a[n/2]
	}
	return (a[n/2-1] + a[n/2]) / 2
}

func clamp(x, lo, hi float64) float64 {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}
