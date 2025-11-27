package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/handlers"
	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport/providers"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"github.com/rs/cors"
)

func main() {
	// Load .env file if it exists
	_ = godotenv.Load()

	// Root context for background workers and graceful shutdown
	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Get database URL from environment
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	// Connect to database
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Test database connection
	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	// Run migrations on startup
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		log.Fatalf("Failed to init migration driver: %v", err)
	}
	migrator, err := migrate.NewWithDatabaseInstance("file://db/migrations", "postgres", driver)
	if err != nil {
		log.Fatalf("Failed to create migrator: %v", err)
	}
	if err := migrator.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("Database migration failed: %v", err)
	}
	log.Println("Database is up-to-date")

	// Initialize handlers
	h := handlers.New(db)

	// Setup router
	r := mux.NewRouter()

	// Health check
	r.HandleFunc("/health", h.Health).Methods("GET")

	// User endpoints
	r.HandleFunc("/api/users", h.CreateUser).Methods("POST")
	r.HandleFunc("/api/users/{id}", h.GetUser).Methods("GET")
	r.HandleFunc("/api/users/{id}", h.UpdateUser).Methods("PUT")

	// Social connections endpoints
	r.HandleFunc("/api/social-connections", h.CreateSocialConnection).Methods("POST")
	r.HandleFunc("/api/social-connections/user/{userId}", h.GetUserSocialConnections).Methods("GET")

	// Social library (cached copies of user created content)
	r.HandleFunc("/api/social-libraries/user/{userId}", h.ListSocialLibrariesForUser).Methods("GET")
	r.HandleFunc("/api/social-libraries/sync/user/{userId}", h.SyncSocialLibrariesForUser).Methods("POST")

	// Team endpoints
	r.HandleFunc("/api/teams", h.CreateTeam).Methods("POST")
	r.HandleFunc("/api/teams/{id}", h.GetTeam).Methods("GET")
	r.HandleFunc("/api/teams/user/{userId}", h.GetUserTeams).Methods("GET")

	// Suno integration endpoints
	r.HandleFunc("/api/suno/tasks", h.CreateSunoTask).Methods("POST")
	r.HandleFunc("/api/suno/tracks/user/{userId}", h.ListSunoTracksForUser).Methods("GET")
	r.HandleFunc("/api/suno/tracks/{id}", h.UpdateSunoTrack).Methods("PUT")
	r.HandleFunc("/api/suno/store", h.StoreSunoTrack).Methods("POST")
	// Suno async callbacks (SunoAPI provider → our backend)
	r.HandleFunc("/callback/suno/music", h.SunoMusicCallback).Methods("POST")
	r.HandleFunc("/callback/suno/music/", h.SunoMusicCallback).Methods("POST")

	// User settings (for per-user Suno API keys)
	r.HandleFunc("/api/user-settings/{userId}", h.GetUserSettings).Methods("GET")
	r.HandleFunc("/api/user-settings/{userId}/{key}", h.GetUserSetting).Methods("GET")
	r.HandleFunc("/api/user-settings/{userId}/{key}", h.UpsertUserSetting).Methods("PUT")

	// CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	handler := c.Handler(r)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "18911"
	}

	srv := &http.Server{
		Handler:      handler,
		Addr:         ":" + port,
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	// Handle graceful shutdown on SIGINT/SIGTERM
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// Background: per-provider social import workers (each with independent rate limiting/quota handling).
	// Disabled by default; enable explicitly in prod after configuring tokens + quotas.
	{
		enabled := os.Getenv("SOCIAL_IMPORT_WORKERS_ENABLED")
		if enabled == "true" {
			parseInterval := func(envKey string, def time.Duration) time.Duration {
				if v := os.Getenv(envKey); v != "" {
					var secs int
					if _, err := fmt.Sscanf(v, "%d", &secs); err == nil && secs > 0 {
						return time.Duration(secs) * time.Second
					}
				}
				return def
			}
			runner := &socialimport.Runner{DB: db, Logger: log.Default()}
			go runner.StartProviderWorker(rootCtx, providers.InstagramProvider{}, parseInterval("SOCIAL_IMPORT_INSTAGRAM_INTERVAL_SECONDS", 15*time.Minute))
			go runner.StartProviderWorker(rootCtx, providers.FacebookProvider{}, parseInterval("SOCIAL_IMPORT_FACEBOOK_INTERVAL_SECONDS", 30*time.Minute))
			go runner.StartProviderWorker(rootCtx, providers.TikTokProvider{}, parseInterval("SOCIAL_IMPORT_TIKTOK_INTERVAL_SECONDS", 30*time.Minute))
			go runner.StartProviderWorker(rootCtx, providers.YouTubeProvider{}, parseInterval("SOCIAL_IMPORT_YOUTUBE_INTERVAL_SECONDS", 60*time.Minute))
			go runner.StartProviderWorker(rootCtx, providers.PinterestProvider{}, parseInterval("SOCIAL_IMPORT_PINTEREST_INTERVAL_SECONDS", 60*time.Minute))
			go runner.StartProviderWorker(rootCtx, providers.ThreadsProvider{}, parseInterval("SOCIAL_IMPORT_THREADS_INTERVAL_SECONDS", 60*time.Minute))
		} else {
			log.Printf("[SocialWorker] disabled (set SOCIAL_IMPORT_WORKERS_ENABLED=true to enable)")
		}
	}

	go func() {
		<-stop
		log.Println("Shutting down server...")
		cancel()
		ctx, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel2()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
	}()

	log.Printf("Server starting on port %s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	log.Println("Server stopped")
}
