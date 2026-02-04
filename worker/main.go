package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "/data/uploads"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("db ping failed: %v", err)
	}
	log.Println("✅ worker connected to postgres")

	log.Printf("📁 worker upload dir: %s\n", uploadDir)

	for {
		claimed, analysisID, trackID, err := claimNextAnalysisJob(context.Background(), pool)
		if err != nil {
			log.Printf("claim error: %v\n", err)
			time.Sleep(2 * time.Second)
			continue
		}
		if !claimed {
			time.Sleep(2 * time.Second)
			continue
		}

		log.Printf("🔎 claimed analysis job id=%s track=%s\n", analysisID, trackID)

		err = runAnalysisJob(context.Background(), pool, analysisID, trackID)
		if err != nil {
			log.Printf("❌ analysis failed id=%s track=%s err=%v\n", analysisID, trackID, err)
			_ = markAnalysisFailed(context.Background(), pool, analysisID, err.Error())
		} else {
			log.Printf("✅ analysis done id=%s track=%s\n", analysisID, trackID)
		}
	}
}

func claimNextAnalysisJob(ctx context.Context, pool *pgxpool.Pool) (bool, string, string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Claim one queued analysis row and mark it running atomically
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
		// no rows -> nothing queued
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

func runAnalysisJob(ctx context.Context, pool *pgxpool.Pool, analysisID, trackID string) error {
	// Get file path
	var srcPath string
	err := pool.QueryRow(ctx, `SELECT original_object_key FROM tracks WHERE id=$1`, trackID).Scan(&srcPath)
	if err != nil {
		return fmt.Errorf("track not found: %w", err)
	}

	// Ensure file exists
	if _, err := os.Stat(srcPath); err != nil {
		return fmt.Errorf("audio file missing at %s: %w", srcPath, err)
	}

	tmpDir, err := os.MkdirTemp("", "bpmworker-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	workingWav := filepath.Join(tmpDir, "working.wav")

	// 1) Convert to consistent WAV
	if err := runCmd(ctx, "ffmpeg", "-y",
		"-ss", "45", "-t", "90",
		"-i", srcPath,
		"-ac", "1", "-ar", "44100",
		workingWav,
	); err != nil {
		return fmt.Errorf("ffmpeg convert failed: %w", err)
	}

	// // 2) Get beat timestamps from aubio tempo CLI
	// beatTimes, err := aubioBeatTimes(ctx, workingWav)
	// if err != nil {
	// 	return fmt.Errorf("aubio tempo failed: %w", err)
	// }
	// if len(beatTimes) < 8 {
	// 	return errors.New("not enough beat events detected to estimate BPM")
	// }

	// // 3) Compute BPM + confidence from beat intervals
	// rawBpm, conf := bpmFromBeats(beatTimes)

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

	// Save finalBpm + conf
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

func runCmd(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	// capture stderr to make debugging easier
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %w\n%s", name, args, err, string(out))
	}
	return nil
}

func aubioDetectBPM(ctx context.Context, wavPath string) (float64, error) {
	cmd := exec.CommandContext(ctx, "aubio", "tempo", "-i", wavPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("aubio tempo failed: %w\n%s", err, string(out))
	}

	// Typical output examples:
	// "131.72 bpm\n"
	// or sometimes: "131.72\n"
	s := strings.TrimSpace(string(out))
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "bpm", "")
	s = strings.TrimSpace(s)

	// If aubio prints multiple tokens, take the first number-like token
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return 0, fmt.Errorf("aubio returned empty output: %q", string(out))
	}

	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse aubio bpm from %q: %w", fields[0], err)
	}

	return v, nil
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

		// aubio sometimes prints one number per line, sometimes "time confidence"
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

	// Build beat intervals
	var intervals []float64
	for i := 1; i < len(beats); i++ {
		d := beats[i] - beats[i-1]
		// ignore unreasonable gaps
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

	// Confidence from consistency: 1 - (MAD/median), clamped
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

	// Example output: "131.72 bpm"
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
	// Candidate BPMs to solve half/double ambiguity
	return []float64{raw, raw * 2.0, raw * 0.5}
}

func chooseBestTempo(beatBpm float64, beatConf float64, tempoBpm float64) (chosenBpm float64, chosenConf float64) {
	// Start with beat-based estimate (usually more stable), then “snap” to half/double if that matches tempoBpm better.
	cands := resolveTempo(beatBpm)

	best := cands[0]
	bestScore := math.Inf(1)

	for _, c := range cands {
		// score = distance to aubio tempo guess (lower better)
		score := math.Abs(c - tempoBpm)

		// penalize implausible range slightly (we still clamp later)
		if c < 60 || c > 220 {
			score += 50
		}

		if score < bestScore {
			bestScore = score
			best = c
		}
	}

	// Confidence: base on beat consistency; if we had to “move” a lot, reduce
	conf := beatConf
	if math.Abs(best-beatBpm) > 5 {
		conf *= 0.75
	}

	return best, clamp(conf, 0, 1)
}

// // aubio tempo prints one beat timestamp per line (seconds)
// func aubioBeatTimes(ctx context.Context, wavPath string) ([]float64, error) {
// 	cmd := exec.CommandContext(ctx, "aubio", "tempo", "-i", wavPath)
// 	stdout, err := cmd.StdoutPipe()
// 	if err != nil {
// 		return nil, err
// 	}
// 	stderr, err := cmd.StderrPipe()
// 	if err != nil {
// 		return nil, err
// 	}

// 	if err := cmd.Start(); err != nil {
// 		return nil, err
// 	}

// 	var beats []float64
// 	sc := bufio.NewScanner(stdout)
// 	for sc.Scan() {
// 		line := strings.TrimSpace(sc.Text())
// 		if line == "" {
// 			continue
// 		}

// 		// aubio often prints: "<time> <confidence>"
// 		fields := strings.Fields(line)
// 		if len(fields) == 0 {
// 			continue
// 		}

// 		v, err := strconv.ParseFloat(fields[0], 64)
// 		if err == nil && v > 0 {
// 			beats = append(beats, v)
// 		}
// 	}

// 	// read stderr for errors
// 	serr, _ := ioReadAllString(stderr)

// 	if err := cmd.Wait(); err != nil {
// 		return nil, fmt.Errorf("aubio tempo error: %w; stderr=%s", err, serr)
// 	}
// 	if err := sc.Err(); err != nil {
// 		return nil, err
// 	}

// 	return beats, nil
// }

// // BPM computed from median interval to reduce outliers.
// // Confidence derived from interval consistency (lower dispersion => higher confidence).
// func bpmFromBeats(beats []float64) (bpm float64, confidence float64) {
// 	var intervals []float64
// 	for i := 1; i < len(beats); i++ {
// 		d := beats[i] - beats[i-1]
// 		if d > 0.2 && d < 2.0 { // ignore crazy intervals
// 			intervals = append(intervals, d)
// 		}
// 	}
// 	if len(intervals) < 6 {
// 		return 0, 0
// 	}

// 	sort.Float64s(intervals)
// 	med := median(intervals)
// 	bpm = 60.0 / med

// 	// Confidence: 1 - (MAD / median), clamped
// 	// MAD = median absolute deviation
// 	var absDev []float64
// 	for _, d := range intervals {
// 		absDev = append(absDev, math.Abs(d-med))
// 	}
// 	sort.Float64s(absDev)
// 	mad := median(absDev)

// 	// normalize; typical good tracks have small MAD
// 	confidence = 1.0 - (mad / med)
// 	return bpm, confidence
// }

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

func ioReadAllString(r io.Reader) (string, error) {
	if r == nil {
		return "", nil
	}
	b, err := io.ReadAll(r)
	return string(b), err
}
