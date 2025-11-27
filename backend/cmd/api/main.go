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
	"github.com/PortNumber53/simple-social-thing/backend/internal/instagram"
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

	// Background: Instagram importer (polls Graph API and upserts into SocialLibraries)
	{
		enabled := os.Getenv("INSTAGRAM_IMPORT_ENABLED")
		if enabled == "" || enabled == "true" {
			interval := 10 * time.Minute
			if v := os.Getenv("INSTAGRAM_IMPORT_INTERVAL_SECONDS"); v != "" {
				var secs int
				if _, err := fmt.Sscanf(v, "%d", &secs); err == nil && secs > 0 {
					interval = time.Duration(secs) * time.Second
				}
			}
			imp := &instagram.Importer{DB: db, Interval: interval}
			go imp.Start(rootCtx)
		} else {
			log.Printf("[IGImporter] disabled via INSTAGRAM_IMPORT_ENABLED=%q", enabled)
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
