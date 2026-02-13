package api

import (
	"io"
	"net/http"
	"strings"
)

func (s *Server) handleRenderFile(w http.ResponseWriter, r *http.Request) {
	// Expect: /api/render-files/{renderId}
	renderID := strings.TrimPrefix(r.URL.Path, "/api/render-files/")
	renderID = strings.Trim(renderID, "/")
	if renderID == "" {
		http.Error(w, "missing render id", http.StatusBadRequest)
		return
	}

	// Auth: ensure render belongs to current user
	userID, _ := UserIDFromContext(r.Context())

	var key string
	err := s.DB.QueryRow(r.Context(), `
SELECT r.output_object_key
FROM render_jobs r
JOIN tracks t ON t.id = r.track_id
WHERE r.id=$1 AND t.user_id=$2
`, renderID, userID).Scan(&key)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(key) == "" {
		http.Error(w, "render output not ready", http.StatusConflict)
		return
	}

	body, ctype, err := s.R2.GetObjectStream(r.Context(), key)
	if err != nil {
		http.Error(w, "failed to fetch object", http.StatusBadGateway)
		return
	}
	defer body.Close()

	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "private, max-age=0")
	// Optional: force download:
	// w.Header().Set("Content-Disposition", "attachment; filename=run-version.mp3")
	_, _ = io.Copy(w, body)
}
