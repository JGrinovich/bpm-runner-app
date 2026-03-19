package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

type createRenderReq struct {
	TargetBPM float64 `json:"target_bpm"`
}

func (s *Server) handleCreateRenderJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	trackID := strings.TrimPrefix(r.URL.Path, "/api/tracks/render/")
	if trackID == "" || trackID == r.URL.Path {
		http.Error(w, "missing track id", http.StatusBadRequest)
		return
	}

	var req createRenderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.TargetBPM <= 0 {
		http.Error(w, "invalid target bpm", http.StatusBadRequest)
		return
	}

	// ensure track belongs to user
	var exists bool
	err := s.DB.QueryRow(r.Context(), `
SELECT EXISTS(
  SELECT 1 FROM tracks
  WHERE id=$1 AND user_id=$2
)
`, trackID, userID).Scan(&exists)

	if err != nil || !exists {
		http.Error(w, "track not found", http.StatusNotFound)
		return
	}

	// ensure analysis is done
	var status string
	err = s.DB.QueryRow(r.Context(), `
SELECT status
FROM track_analysis
WHERE track_id=$1
`, trackID).Scan(&status)

	if err != nil || status != "done" {
		http.Error(w, "analysis not ready", http.StatusConflict)
		return
	}

	// ⭐ THIS IS WHERE YOUR INSERT GOES ⭐
	var renderID string
	err = s.DB.QueryRow(r.Context(), `
INSERT INTO render_jobs (
  id,
  track_id,
  target_bpm,
  tempo_ratio,
  preserve_pitch,
  status,
  created_at
)
VALUES (
  gen_random_uuid(),
  $1,
  $2,
  NULL,
  TRUE,
  'queued',
  now()
)
RETURNING id
`, trackID, req.TargetBPM).Scan(&renderID)

	if err != nil {
		http.Error(w, "failed to create render job", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"id":"` + renderID + `"}`))
}
