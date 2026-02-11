package api

import (
	"net/http"
	"os"
	"strings"
)

func WithCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Build allowlist from env
		allowed := map[string]bool{}
		for _, o := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				allowed[o] = true
			}
		}

		if allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}

		// Handle preflight
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
