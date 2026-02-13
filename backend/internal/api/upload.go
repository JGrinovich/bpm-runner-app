package api

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxUploadBytes = 50 << 20 // 50 MB
)

var allowedMIMEs = map[string]bool{
	"audio/mpeg":               true, // mp3
	"audio/wav":                true,
	"audio/x-wav":              true,
	"audio/mp4":                true, // m4a often reports audio/mp4
	"audio/aac":                true,
	"application/octet-stream": true, // some browsers/OSes do this; we still sniff bytes
}

type signedURLReq struct {
	Filename string `json:"filename"`
	MimeType string `json:"mime_type"`
}

type signedURLResp struct {
	ObjectKey    string `json:"object_key"`
	SignedPutURL string `json:"signed_put_url"`
}

func (s *Server) handleSignedUploadURL(w http.ResponseWriter, r *http.Request) {
	log.Println("✅ handleSignedURL HIT")

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := UserIDFromContext(r.Context())
	if !ok || userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req signedURLReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	req.Filename = strings.TrimSpace(req.Filename)
	req.MimeType = strings.ToLower(strings.TrimSpace(req.MimeType))

	if req.Filename == "" || req.MimeType == "" {
		http.Error(w, "filename and mime_type required", http.StatusBadRequest)
		return
	}

	ext := strings.ToLower(filepath.Ext(req.Filename))
	if ext == "" {
		http.Error(w, "file extension required", http.StatusBadRequest)
		return
	}

	// Extension allowlist (keep MVP small)
	allowedExt := map[string]bool{".mp3": true, ".wav": true, ".m4a": true, ".aac": true}
	if !allowedExt[ext] {
		http.Error(w, "unsupported file type", http.StatusBadRequest)
		return
	}

	// Mime allowlist (reuse your existing allowlist)
	if !allowedMIMEs[req.MimeType] {
		http.Error(w, "unsupported mime_type", http.StatusBadRequest)
		return
	}

	// Storage must be configured
	if s.Presigner == nil {
		http.Error(w, "storage not configured", http.StatusServiceUnavailable)
		return
	}

	// Key format: uploads/<userId>/<uuid>.<ext>
	prefix := s.UploadPrefix
	if prefix == "" {
		prefix = "uploads"
	}
	key := prefix + "/" + userID + "/" + uuid.New().String() + ext

	ttl := 15 * time.Minute
	url, err := s.Presigner.PresignPut(r.Context(), key, req.MimeType, ttl)
	if err != nil {
		http.Error(w, "failed to presign", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, signedURLResp{
		ObjectKey:    key,
		SignedPutURL: url,
	})
}
