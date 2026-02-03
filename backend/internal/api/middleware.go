package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/JGrinovich/bpm-runner-app/backend/internal/auth"
)

type ctxKey string

const userIDKey ctxKey = "user_id"

func UserIDFromContext(ctx context.Context) (string, bool) {
	v := ctx.Value(userIDKey)
	s, ok := v.(string)
	return s, ok
}

func AuthMiddleware(jwtSecret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if h == "" || !strings.HasPrefix(h, "Bearer ") {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		token := strings.TrimPrefix(h, "Bearer ")
		userID, err := auth.VerifyJWT(token, jwtSecret)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
