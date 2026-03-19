package api

import (
	"net/http"
	"os"
	"strings"
)

func (s *Server) handleRenderFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	renderID := strings.TrimPrefix(r.URL.Path, "/api/render-files/")
	if renderID == "" || renderID == r.URL.Path {
		http.Error(w, "missing render id", http.StatusBadRequest)
		return
	}

	userID, ok := UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var outPath string
	var status string

	err := s.DB.QueryRow(r.Context(), `
SELECT r.output_object_key, r.status
FROM render_jobs r
JOIN tracks t ON t.id = r.track_id
WHERE r.id = $1 AND t.user_id = $2
`, renderID, userID).Scan(&outPath, &status)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	if status != "done" || outPath == "" {
		http.Error(w, "render not ready", http.StatusConflict)
		return
	}

	if _, err := os.Stat(outPath); err != nil {
		http.Error(w, "file missing on server", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "audio/mpeg")
	http.ServeFile(w, r, outPath)
}
