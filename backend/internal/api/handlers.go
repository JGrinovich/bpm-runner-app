package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/JGrinovich/bpm-runner-app/backend/internal/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	DB        *pgxpool.Pool
	JWTSecret string
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// Public
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/api/auth/signup", s.handleSignup)
	mux.HandleFunc("/api/auth/login", s.handleLogin)

	// Protected (wrap individual handlers)
	mux.Handle("/api/me", AuthMiddleware(s.JWTSecret, http.HandlerFunc(s.handleMe)))
	mux.Handle("/api/tracks", AuthMiddleware(s.JWTSecret, http.HandlerFunc(s.handleTracks)))
	mux.Handle("/api/tracks/", AuthMiddleware(s.JWTSecret, http.HandlerFunc(s.handleTrackByID)))
	mux.Handle("/api/renders/", AuthMiddleware(s.JWTSecret, http.HandlerFunc(s.handleRenderByID)))
	mux.Handle("/api/tracks/upload", AuthMiddleware(s.JWTSecret, http.HandlerFunc(s.handleTrackUpload)))

	// Upload signed-url (stub for Phase 1)
	mux.Handle("/api/uploads/signed-url", AuthMiddleware(s.JWTSecret, http.HandlerFunc(s.handleSignedURLStub)))

	return mux
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.DB.Ping(ctx); err != nil {
		http.Error(w, "db not ready", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req SignupRequest
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || len(req.Password) < 8 {
		http.Error(w, "email required and password must be >= 8 chars", http.StatusBadRequest)
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "hash failed", http.StatusInternalServerError)
		return
	}

	var userID string
	err = s.DB.QueryRow(r.Context(),
		`INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id`,
		req.Email, hash,
	).Scan(&userID)
	if err != nil {
		// unique violation etc.
		http.Error(w, "could not create user (maybe email exists)", http.StatusBadRequest)
		return
	}

	token, err := auth.SignJWT(userID, s.JWTSecret)
	if err != nil {
		http.Error(w, "jwt failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, AuthResponse{Token: token})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req LoginRequest
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		http.Error(w, "email/password required", http.StatusBadRequest)
		return
	}

	var userID, hash string
	err := s.DB.QueryRow(r.Context(),
		`SELECT id, password_hash FROM users WHERE email=$1`,
		req.Email,
	).Scan(&userID, &hash)
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := auth.SignJWT(userID, s.JWTSecret)
	if err != nil {
		http.Error(w, "jwt failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, AuthResponse{Token: token})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	userID, _ := UserIDFromContext(r.Context())
	writeJSON(w, http.StatusOK, map[string]string{"user_id": userID})
}

func (s *Server) handleTracks(w http.ResponseWriter, r *http.Request) {
	userID, _ := UserIDFromContext(r.Context())

	switch r.Method {
	case http.MethodPost:
		var req CreateTrackRequest
		if err := readJSON(r, &req); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if req.SourceFilename == "" || req.MimeType == "" || req.OriginalObjectKey == "" {
			http.Error(w, "source_filename, mime_type, original_object_key required", http.StatusBadRequest)
			return
		}

		var trackID string
		err := s.DB.QueryRow(r.Context(),
			`INSERT INTO tracks (user_id, title, source_filename, mime_type, duration_sec, original_object_key)
			 VALUES ($1,$2,$3,$4,$5,$6)
			 RETURNING id`,
			userID, req.Title, req.SourceFilename, req.MimeType, req.DurationSec, req.OriginalObjectKey,
		).Scan(&trackID)
		if err != nil {
			http.Error(w, "insert failed", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": trackID})

	case http.MethodGet:
		rows, err := s.DB.Query(r.Context(),
			`SELECT id, title, source_filename, mime_type, duration_sec, original_object_key, created_at
			 FROM tracks WHERE user_id=$1 ORDER BY created_at DESC`,
			userID,
		)
		if err != nil {
			http.Error(w, "query failed", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var out []TrackResponse
		for rows.Next() {
			var tr TrackResponse
			var created time.Time
			if err := rows.Scan(&tr.ID, &tr.Title, &tr.SourceFilename, &tr.MimeType, &tr.DurationSec, &tr.OriginalObjectKey, &created); err != nil {
				http.Error(w, "scan failed", http.StatusInternalServerError)
				return
			}
			tr.CreatedAt = created.Format(time.RFC3339)
			out = append(out, tr)
		}
		writeJSON(w, http.StatusOK, out)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleTrackByID(w http.ResponseWriter, r *http.Request) {
	// Routes:
	// GET  /api/tracks/:id
	// POST /api/tracks/:id/analyze
	// POST /api/tracks/:id/render
	// GET  /api/tracks/:id/analysis

	path := strings.TrimPrefix(r.URL.Path, "/api/tracks/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	trackID := parts[0]
	if _, err := uuid.Parse(trackID); err != nil {
		http.Error(w, "invalid uuid", http.StatusBadRequest)
		return
	}

	userID, _ := UserIDFromContext(r.Context())

	// Sub-routes
	if len(parts) == 2 && parts[1] == "analyze" && r.Method == http.MethodPost {
		s.handleAnalyze(w, r, userID, trackID)
		return
	}
	if len(parts) == 2 && parts[1] == "render" && r.Method == http.MethodPost {
		s.handleRender(w, r, userID, trackID)
		return
	}
	if len(parts) == 2 && parts[1] == "analysis" && r.Method == http.MethodGet {
		s.handleGetAnalysis(w, r, userID, trackID)
		return
	}

	// Default: GET /api/tracks/:id
	if len(parts) == 1 && r.Method == http.MethodGet {
		s.handleGetTrack(w, r, userID, trackID)
		return
	}

	http.Error(w, "not found", http.StatusNotFound)
}

func (s *Server) ensureTrackOwnership(ctx context.Context, userID, trackID string) error {
	var exists bool
	err := s.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM tracks WHERE id=$1 AND user_id=$2)`,
		trackID, userID,
	).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("not found")
	}
	return nil
}

func (s *Server) handleGetTrack(w http.ResponseWriter, r *http.Request, userID, trackID string) {
	if err := s.ensureTrackOwnership(r.Context(), userID, trackID); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Track
	var tr TrackResponse
	var created time.Time
	err := s.DB.QueryRow(r.Context(),
		`SELECT id, title, source_filename, mime_type, duration_sec, original_object_key, created_at
		 FROM tracks WHERE id=$1`,
		trackID,
	).Scan(&tr.ID, &tr.Title, &tr.SourceFilename, &tr.MimeType, &tr.DurationSec, &tr.OriginalObjectKey, &created)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	tr.CreatedAt = created.Format(time.RFC3339)

	// Analysis (optional)
	var analysis any = nil
	var aID *string
	var bpm *float64
	var conf *float64
	var status string
	var errMsg *string
	var finished *time.Time

	_ = s.DB.QueryRow(r.Context(),
		`SELECT id, bpm, confidence, status, error_message, finished_at
		 FROM track_analysis WHERE track_id=$1`,
		trackID,
	).Scan(&aID, &bpm, &conf, &status, &errMsg, &finished)

	if aID != nil {
		m := map[string]any{
			"id":         *aID,
			"bpm":        bpm,
			"confidence": conf,
			"status":     status,
			"error":      errMsg,
		}
		if finished != nil {
			m["finished_at"] = finished.Format(time.RFC3339)
		}
		analysis = m
	}

	// Latest render (optional)
	var latestRender any = nil
	var rID *string
	var targetBpm *float64
	var rStatus *string
	var outKey *string
	_ = s.DB.QueryRow(r.Context(),
		`SELECT id, target_bpm, status, output_object_key
		 FROM render_jobs WHERE track_id=$1 ORDER BY created_at DESC LIMIT 1`,
		trackID,
	).Scan(&rID, &targetBpm, &rStatus, &outKey)

	if rID != nil {
		latestRender = map[string]any{
			"id":                *rID,
			"target_bpm":        *targetBpm,
			"status":            *rStatus,
			"output_object_key": outKey,
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"track":         tr,
		"analysis":      analysis,
		"latest_render": latestRender,
	})
}

func (s *Server) handleAnalyze(w http.ResponseWriter, r *http.Request, userID, trackID string) {
	if err := s.ensureTrackOwnership(r.Context(), userID, trackID); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// Insert or reset analysis row to queued
	_, err := s.DB.Exec(r.Context(),
		`INSERT INTO track_analysis (track_id, status)
		 VALUES ($1,'queued')
		 ON CONFLICT (track_id) DO UPDATE
		   SET status='queued', error_message=NULL, bpm=NULL, confidence=NULL, created_at=now(), finished_at=NULL`,
		trackID,
	)
	if err != nil {
		http.Error(w, "enqueue failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusAccepted, AnalyzeResponse{TrackID: trackID, Status: "queued"})
}

func (s *Server) handleGetAnalysis(w http.ResponseWriter, r *http.Request, userID, trackID string) {
	if err := s.ensureTrackOwnership(r.Context(), userID, trackID); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var id string
	var bpm *float64
	var conf *float64
	var status string
	var errMsg *string
	var created time.Time
	var finished *time.Time

	err := s.DB.QueryRow(r.Context(),
		`SELECT id, bpm, confidence, status, error_message, created_at, finished_at
		 FROM track_analysis WHERE track_id=$1`,
		trackID,
	).Scan(&id, &bpm, &conf, &status, &errMsg, &created, &finished)
	if err != nil {
		http.Error(w, "no analysis", http.StatusNotFound)
		return
	}

	resp := map[string]any{
		"id":         id,
		"track_id":   trackID,
		"bpm":        bpm,
		"confidence": conf,
		"status":     status,
		"error":      errMsg,
		"created_at": created.Format(time.RFC3339),
	}
	if finished != nil {
		resp["finished_at"] = finished.Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRender(w http.ResponseWriter, r *http.Request, userID, trackID string) {
	if err := s.ensureTrackOwnership(r.Context(), userID, trackID); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var req RenderRequest
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.TargetBpm < 40 || req.TargetBpm > 260 {
		http.Error(w, "target_bpm out of range", http.StatusBadRequest)
		return
	}
	// tempo_ratio will be computed later by worker once it knows detected BPM
	// For Phase 1, we set a placeholder ratio = 1.0; worker will update later.
	tempoRatio := 1.0
	if !req.PreservePitch {
		// Keep field for future, but we still preserve pitch for MVP.
	}

	var renderID string
	err := s.DB.QueryRow(r.Context(),
		`INSERT INTO render_jobs (track_id, target_bpm, tempo_ratio, preserve_pitch, status)
		 VALUES ($1,$2,$3,$4,'queued')
		 RETURNING id`,
		trackID, req.TargetBpm, tempoRatio, req.PreservePitch,
	).Scan(&renderID)
	if err != nil {
		http.Error(w, "enqueue failed", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusAccepted, RenderResponse{RenderID: renderID, Status: "queued"})
}

func (s *Server) handleRenderByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	renderID := strings.TrimPrefix(r.URL.Path, "/api/renders/")
	if _, err := uuid.Parse(renderID); err != nil {
		http.Error(w, "invalid uuid", http.StatusBadRequest)
		return
	}

	userID, _ := UserIDFromContext(r.Context())

	// Ensure the render belongs to a track owned by user
	var (
		id            string
		trackID       string
		targetBpm     float64
		tempoRatio    float64
		preservePitch bool
		status        string
		outputKey     *string
		errMsg        *string
		created       time.Time
		finished      *time.Time
	)
	err := s.DB.QueryRow(r.Context(),
		`SELECT r.id, r.track_id, r.target_bpm, r.tempo_ratio, r.preserve_pitch, r.status, r.output_object_key, r.error_message, r.created_at, r.finished_at
		   FROM render_jobs r
		   JOIN tracks t ON t.id = r.track_id
		  WHERE r.id=$1 AND t.user_id=$2`,
		renderID, userID,
	).Scan(&id, &trackID, &targetBpm, &tempoRatio, &preservePitch, &status, &outputKey, &errMsg, &created, &finished)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	resp := map[string]any{
		"id":                id,
		"track_id":          trackID,
		"target_bpm":        targetBpm,
		"tempo_ratio":       tempoRatio,
		"preserve_pitch":    preservePitch,
		"status":            status,
		"output_object_key": outputKey,
		"error":             errMsg,
		"created_at":        created.Format(time.RFC3339),
	}
	if finished != nil {
		resp["finished_at"] = finished.Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleSignedURLStub(w http.ResponseWriter, r *http.Request) {
	// Phase 1: not implementing real S3 signed URLs yet
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"message": "signed-url not implemented in Phase 1 (use local upload in Phase 3)",
	})
}
