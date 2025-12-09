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
	if err := run(defaultDeps()); err != nil {
		log.Fatal(err)
	}
}

type deps struct {
	getenv         func(string) string
	openDB         func(driverName, dataSourceName string) (*sql.DB, error)
	migrateUp      func(db *sql.DB) error
	listenAndServe func(srv *http.Server) error
	notify         func(c chan<- os.Signal, sig ...os.Signal)
	stopCh         chan os.Signal
}

func defaultDeps() deps {
	return deps{
		getenv:         os.Getenv,
		openDB:         sql.Open,
		migrateUp:      migrateUp,
		listenAndServe: (*http.Server).ListenAndServe,
		notify:         signal.Notify,
	}
}

func migrateUp(db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("Failed to init migration driver: %w", err)
	}
	migrator, err := migrate.NewWithDatabaseInstance("file://db/migrations", "postgres", driver)
	if err != nil {
		return fmt.Errorf("Failed to create migrator: %w", err)
	}
	if err := migrator.Up(); err != nil && err != migrate.ErrNoChange {
		// If the DB is dirty, allow an opt-in forced recovery.
		// This is a common failure mode after an interrupted migration.
		if os.Getenv("MIGRATE_FORCE_DIRTY") != "" {
			v, dirty, verr := migrator.Version()
			if verr == nil && dirty {
				// Force to the current version (clears dirty flag), then retry.
				if ferr := migrator.Force(int(v)); ferr == nil {
					if err2 := migrator.Up(); err2 == nil || err2 == migrate.ErrNoChange {
						log.Printf("Database was dirty at version %d; forced and recovered", v)
						return nil
					} else {
						return fmt.Errorf("Database migration failed after forcing dirty version %d: %w", v, err2)
					}
				}
			}
		}
		// Keep error message explicit for manual recovery (best-effort hint).
		if v, dirty, verr := migrator.Version(); verr == nil && dirty {
			return fmt.Errorf("Database migration failed: %w (hint: run `go run db/migrate.go -force=%d` or set MIGRATE_FORCE_DIRTY=1)", err, v)
		}
		return fmt.Errorf("Database migration failed: %w", err)
	}
	return nil
}

func run(d deps) error {
	// Root context for background workers and graceful shutdown
	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Get database URL from environment
	databaseURL := ""
	if d.getenv != nil {
		databaseURL = d.getenv("DATABASE_URL")
	}
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable is required")
	}

	// Connect to database
	if d.openDB == nil {
		return fmt.Errorf("openDB dependency is required")
	}
	db, err := d.openDB("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("Failed to connect to database: %w", err)
	}
	defer db.Close()

	// Test database connection
	if err := db.Ping(); err != nil {
		return fmt.Errorf("Failed to ping database: %w", err)
	}

	// Run migrations on startup
	if d.migrateUp != nil {
		if err := d.migrateUp(db); err != nil {
			return err
		}
	}
	log.Println("Database is up-to-date")

	// Initialize handlers
	h := handlers.New(db)

	// Setup router
	r := buildRouter(h)

	// CORS middleware
	handler := buildCORSHandler(r)

	// Start server
	port := resolvePort(d.getenv)
	srv := newHTTPServer(handler, port)

	// Handle graceful shutdown on SIGINT/SIGTERM
	stop := d.stopCh
	if stop == nil {
		stop = make(chan os.Signal, 1)
		if d.notify != nil {
			d.notify(stop, os.Interrupt, syscall.SIGTERM)
		}
	}

	// Background: per-provider social import workers (each with independent rate limiting/quota handling).
	// Disabled by default; enable explicitly in prod after configuring tokens + quotas.
	startSocialImportWorkersIfEnabled(rootCtx, db, d.getenv)

	// Background: scheduled post poller (publishes due posts and enqueues publish jobs).
	startScheduledPostsWorker(rootCtx, h, d.getenv)

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
	if d.listenAndServe == nil {
		return fmt.Errorf("listenAndServe dependency is required")
	}
	if err := d.listenAndServe(srv); err != nil && err != http.ErrServerClosed {
		return err
	}
	log.Println("Server stopped")
	return nil
}

func resolvePort(getenv func(string) string) string {
	if getenv == nil {
		return "18911"
	}
	port := getenv("PORT")
	if port == "" {
		return "18911"
	}
	return port
}

func parseIntervalFromEnv(getenv func(string) string, envKey string, def time.Duration) time.Duration {
	if getenv == nil {
		return def
	}
	if v := getenv(envKey); v != "" {
		var secs int
		if _, err := fmt.Sscanf(v, "%d", &secs); err == nil && secs > 0 {
			return time.Duration(secs) * time.Second
		}
	}
	return def
}

func startSocialImportWorkersIfEnabled(ctx context.Context, db *sql.DB, getenv func(string) string) {
	v := ""
	if getenv != nil {
		v = getenv("SOCIAL_IMPORT_WORKERS_ENABLED")
	}
	if v != "true" {
		log.Printf("[SocialWorker] disabled (set SOCIAL_IMPORT_WORKERS_ENABLED=true to enable)")
		return
	}

	runner := &socialimport.Runner{DB: db, Logger: log.Default()}
	go runner.StartProviderWorker(ctx, providers.InstagramProvider{}, parseIntervalFromEnv(getenv, "SOCIAL_IMPORT_INSTAGRAM_INTERVAL_SECONDS", 15*time.Minute))
	go runner.StartProviderWorker(ctx, providers.FacebookProvider{}, parseIntervalFromEnv(getenv, "SOCIAL_IMPORT_FACEBOOK_INTERVAL_SECONDS", 30*time.Minute))
	go runner.StartProviderWorker(ctx, providers.TikTokProvider{}, parseIntervalFromEnv(getenv, "SOCIAL_IMPORT_TIKTOK_INTERVAL_SECONDS", 30*time.Minute))
	go runner.StartProviderWorker(ctx, providers.YouTubeProvider{}, parseIntervalFromEnv(getenv, "SOCIAL_IMPORT_YOUTUBE_INTERVAL_SECONDS", 60*time.Minute))
	go runner.StartProviderWorker(ctx, providers.PinterestProvider{}, parseIntervalFromEnv(getenv, "SOCIAL_IMPORT_PINTEREST_INTERVAL_SECONDS", 60*time.Minute))
	go runner.StartProviderWorker(ctx, providers.ThreadsProvider{}, parseIntervalFromEnv(getenv, "SOCIAL_IMPORT_THREADS_INTERVAL_SECONDS", 60*time.Minute))
}

func startScheduledPostsWorker(ctx context.Context, h *handlers.Handler, getenv func(string) string) {
	interval := parseIntervalFromEnv(getenv, "SCHEDULED_POSTS_INTERVAL_SECONDS", 60*time.Second)
	origin := ""
	if getenv != nil {
		origin = getenv("PUBLIC_ORIGIN")
	}
	go h.StartScheduledPostsWorker(ctx, interval, origin)
}

func buildCORSHandler(r http.Handler) http.Handler {
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})
	return c.Handler(r)
}

func newHTTPServer(handler http.Handler, port string) *http.Server {
	return &http.Server{
		Handler: handler,
		Addr:    ":" + port,
		// Publishing (Facebook pages fan-out + Instagram container creation/publish) can legitimately take > 15s.
		// If these are too low, nginx will see "upstream prematurely closed connection" and return 502.
		WriteTimeout: 120 * time.Second,
		ReadTimeout:  120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
}

func buildRouter(h *handlers.Handler) *mux.Router {
	r := mux.NewRouter()

	// Health check
	r.HandleFunc("/health", h.Health).Methods("GET")

	// Realtime events (WebSocket). This is intended to be proxied by the Worker which authenticates the browser session.
	r.HandleFunc("/api/events/ws", h.EventsWebSocket)
	// Debug endpoint to validate internal WS auth from the Worker.
	r.HandleFunc("/api/events/ping", h.EventsPing).Methods("GET")

	// Public media (uploaded assets used for publishing)
	// NOTE: required for Instagram publishing which needs public HTTPS URLs for images.
	r.PathPrefix("/media/").Handler(http.StripPrefix("/media/", http.FileServer(http.Dir("media"))))

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
	r.HandleFunc("/api/social-libraries/import/user/{userId}", h.ImportSocialLibraryForUser).Methods("POST")
	// Batch delete cached library items for a user
	r.HandleFunc("/api/social-libraries/delete/user/{userId}", h.DeleteSocialLibrariesForUser).Methods("POST")

	// Notifications (manual actions, errors, etc.)
	r.HandleFunc("/api/notifications/user/{userId}", h.ListNotificationsForUser).Methods("GET")
	r.HandleFunc("/api/notifications/{id}/read/user/{userId}", h.MarkNotificationReadForUser).Methods("POST")

	// Publishing: post content to connected networks
	r.HandleFunc("/api/social-posts/publish/user/{userId}", h.PublishSocialPostForUser).Methods("POST")
	// Publishing (async): enqueue job + return jobId immediately
	r.HandleFunc("/api/social-posts/publish-async/user/{userId}", h.EnqueuePublishJobForUser).Methods("POST")
	// Publishing job status
	r.HandleFunc("/api/social-posts/publish-jobs/{jobId}", h.GetPublishJob).Methods("GET")

	// Local content library (draft/scheduled posts stored in DB)
	r.HandleFunc("/api/posts/user/{userId}", h.ListPostsForUser).Methods("GET")
	r.HandleFunc("/api/posts/user/{userId}", h.CreatePostForUser).Methods("POST")
	r.HandleFunc("/api/posts/{postId}/user/{userId}", h.UpdatePostForUser).Methods("PUT")
	r.HandleFunc("/api/posts/{postId}/user/{userId}", h.DeletePostForUser).Methods("DELETE")
	// Publish a scheduled post immediately (for testing / manual override)
	r.HandleFunc("/api/posts/{postId}/publish-now/user/{userId}", h.PublishNowPostForUser).Methods("POST")

	// Local uploads for drafts/publishing (stored under /media/uploads/<userId>/)
	r.HandleFunc("/api/uploads/user/{userId}", h.ListUploadsForUser).Methods("GET")
	r.HandleFunc("/api/uploads/user/{userId}", h.UploadUploadsForUser).Methods("POST")
	r.HandleFunc("/api/uploads/delete/user/{userId}", h.DeleteUploadsForUser).Methods("POST")

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

	return r
}
