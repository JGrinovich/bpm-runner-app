package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
)

func (s *Server) handleRenderFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	renderID := strings.TrimPrefix(r.URL.Path, "/api/render-files/")
	renderID = strings.TrimSuffix(renderID, "/file")

	if _, err := uuid.Parse(renderID); err != nil {
		http.Error(w, "invalid uuid", http.StatusBadRequest)
		return
	}

	userID, _ := UserIDFromContext(r.Context())

	// Ensure render belongs to user and is done
	var outPath string
	var status string
	err := s.DB.QueryRow(r.Context(), `
SELECT r.output_object_key, r.status
FROM render_jobs r
JOIN tracks t ON t.id = r.track_id
WHERE r.id=$1 AND t.user_id=$2
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

	// Let browser stream with Range requests (ServeFile supports it)
	w.Header().Set("Content-Type", "audio/mpeg")
	http.ServeFile(w, r, outPath)
}
