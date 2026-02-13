package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/JGrinovich/bpm-runner-app/backend/internal/api"
	"github.com/JGrinovich/bpm-runner-app/backend/internal/db"
	"github.com/JGrinovich/bpm-runner-app/backend/internal/storage"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, dbURL)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("db ping failed: %v", err)
	}
	log.Println("✅ backend connected to postgres")

	r2, err := storage.NewR2Presigner(
		ctx,
		os.Getenv("R2_ACCOUNT_ID"),
		os.Getenv("R2_ACCESS_KEY_ID"),
		os.Getenv("R2_SECRET_ACCESS_KEY"),
		os.Getenv("R2_BUCKET"),
	)
	if err != nil {
		log.Fatalf("r2 presigner init failed: %v", err)
	}

	srv := &api.Server{
		DB:           pool,
		JWTSecret:    jwtSecret,
		Presigner:    r2,
		UploadPrefix: "uploads",
	}

	httpServer := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           api.WithCORS(srv.Routes()),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("🚀 backend listening on :%s\n", port)
	log.Fatal(httpServer.ListenAndServe())
}
