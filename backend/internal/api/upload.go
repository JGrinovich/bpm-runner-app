package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
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

func (s *Server) handleTrackUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, _ := UserIDFromContext(r.Context())

	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "/data/uploads"
	}
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		http.Error(w, "upload dir error", http.StatusInternalServerError)
		return
	}

	// Hard cap request body size (prevents runaway uploads)
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)

	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		http.Error(w, "invalid multipart or file too large", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing form file field 'file'", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Sniff first bytes to get a better content-type
	var head [512]byte
	n, _ := io.ReadFull(file, head[:])
	sniff := http.DetectContentType(head[:n])

	// Reset stream (we need to read full content)
	reader := io.MultiReader(bytes.NewReader(head[:n]), file)

	// Prefer browser mime if it’s reasonable; otherwise use sniff
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = sniff
	}
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))

	// Basic allowlist (MVP)
	if !allowedMIMEs[mimeType] && !allowedMIMEs[sniff] {
		http.Error(w, fmt.Sprintf("unsupported mime: %s (sniff=%s)", mimeType, sniff), http.StatusBadRequest)
		return
	}

	// Generate stable unique filename
	ext := filepath.Ext(header.Filename)
	if ext == "" {
		// Try to infer from sniff
		if exts, _ := mime.ExtensionsByType(sniff); len(exts) > 0 {
			ext = exts[0]
		} else {
			ext = ".bin"
		}
	}
	ext = strings.ToLower(ext)

	objKey := uuid.New().String() + ext
	dstPath := filepath.Join(uploadDir, objKey)

	// Write file to disk while computing hash (optional but very useful)
	out, err := os.Create(dstPath)
	if err != nil {
		http.Error(w, "could not create file", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(out, hasher), reader)
	if err != nil {
		http.Error(w, "write failed", http.StatusInternalServerError)
		return
	}

	// Insert track row
	title := header.Filename
	hashHex := hex.EncodeToString(hasher.Sum(nil))

	var trackID string
	err = s.DB.QueryRow(r.Context(),
		`INSERT INTO tracks (user_id, title, source_filename, mime_type, duration_sec, original_object_key)
		 VALUES ($1,$2,$3,$4,NULL,$5)
		 RETURNING id`,
		userID, title, header.Filename, mimeType, dstPath,
	).Scan(&trackID)
	if err != nil {
		// clean up file if DB insert fails
		_ = os.Remove(dstPath)
		http.Error(w, "db insert failed", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":                  trackID,
		"stored_bytes":        written,
		"original_object_key": dstPath,
		"sha256":              hashHex,
		"created_at":          time.Now().Format(time.RFC3339),
	})
}

// Small helper you’ll likely want later:
func (s *Server) trackPathForWorker(ctx context.Context, trackID string) (string, error) {
	var p string
	err := s.DB.QueryRow(ctx, `SELECT original_object_key FROM tracks WHERE id=$1`, trackID).Scan(&p)
	return p, err
}
