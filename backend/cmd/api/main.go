package main

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
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

	// Start background workers
	h.StartProductArchivalWorker()

	// Ensure all billing plans exist and are synced
	if count, err := h.EnsureAllPlans(rootCtx); err != nil {
		log.Printf("[Startup] Failed to ensure plans: %v", err)
	} else {
		log.Printf("[Startup] Ensured plans (%d synced)", count)
	}

	// Setup router
	r := buildRouter(h)

	// CORS middleware
	handler := buildCORSHandler(r)
	// Request logging (publish debugging): logs only publish-related routes + propagates request id.
	handler = publishRequestLogger(handler)

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

	log.Printf("Server starting on %s", srv.Addr)
	if d.listenAndServe == nil {
		return fmt.Errorf("listenAndServe dependency is required")
	}
	if err := d.listenAndServe(srv); err != nil && err != http.ErrServerClosed {
		return err
	}
	log.Println("Server stopped")
	return nil
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not support hijacking")
	}
	// WebSockets upgrade the connection via Hijack; record a sensible status code for logs.
	if w.status == 0 {
		w.status = http.StatusSwitchingProtocols
	}
	return hj.Hijack()
}

func (w *statusRecorder) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusRecorder) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(p)
	w.bytes += int64(n)
	return n, err
}

func publishRequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		// Default: keep logging focused to avoid noise.
		// If LOG_LEVEL=debug/trace, log all requests.
		lvl := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL")))
		logAll := lvl == "debug" || lvl == "trace"
		isPublish :=
			strings.HasPrefix(path, "/api/social-posts/publish") ||
				strings.Contains(path, "/publish-now") ||
				strings.HasPrefix(path, "/api/posts/publish")
		if !logAll && !isPublish {
			next.ServeHTTP(w, r)
			return
		}

		reqID := r.Header.Get("X-Request-Id")
		if reqID == "" {
			// Fall back to any proxy/cdn id.
			reqID = r.Header.Get("CF-Ray")
			if reqID == "" {
				reqID = r.Header.Get("X-CF-Ray")
			}
		}
		if reqID != "" {
			w.Header().Set("X-Request-Id", reqID)
		}

		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		log.Printf("[HTTP] start reqId=%s method=%s path=%s query=%s remote=%s ua=%q", reqID, r.Method, path, r.URL.RawQuery, r.RemoteAddr, r.UserAgent())
		next.ServeHTTP(rec, r)
		dur := time.Since(start)
		log.Printf("[HTTP] done reqId=%s method=%s path=%s status=%d bytes=%d durMs=%d", reqID, r.Method, path, rec.status, rec.bytes, dur.Milliseconds())
	})
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
		AllowedOrigins:   []string{"http://localhost:18910", "http://localhost:3000", "https://api-simple.dev.portnumber53.com"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})
	return c.Handler(r)
}

func newHTTPServer(handler http.Handler, port string) *http.Server {
	// Listen on all interfaces (IPv4 and IPv6) by default.
	// This is important for Tailscale and other overlay networks that might prefer IPv6.
	// We handle the address formatting here to ensure we don't accidentally bind to just IPv4 (0.0.0.0)
	// or create an invalid address.
	addr := ":" + port
	if strings.Contains(port, ":") {
		// If port string already contains ":", assume it's a full address (e.g. "127.0.0.1:8080")
		addr = port
	}

	return &http.Server{
		Handler: handler,
		Addr:    addr,
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

	// Billing endpoints
	r.HandleFunc("/api/billing/sync/legacy-plans", h.SyncLegacyPlans).Methods("POST")
	r.HandleFunc("/api/billing/plans", h.GetBillingPlans).Methods("GET")
	r.HandleFunc("/api/billing/plans", h.CreateBillingPlan).Methods("POST")
	r.HandleFunc("/api/billing/plans/{id}", h.UpdateBillingPlan).Methods("PUT")
	r.HandleFunc("/api/billing/plans/{id}", h.DeleteBillingPlan).Methods("DELETE")
	r.HandleFunc("/api/billing/plans/{id}/migrate", h.MigrateBillingPlanPrice).Methods("POST")
	r.HandleFunc("/api/billing/plans/{id}/migration-status", h.GetMigrationStatus).Methods("GET")
	r.HandleFunc("/api/billing/plans/{id}/archive", h.ArchiveProduct).Methods("POST")
	r.HandleFunc("/api/billing/products/archive", h.ArchiveOldProducts).Methods("POST")
	r.HandleFunc("/api/billing/subscriptions/migrate", h.MigrateSubscriptionsAfterGracePeriod).Methods("POST")
	r.HandleFunc("/api/billing/product-versions/{versionGroup}", h.GetProductVersions).Methods("GET")
	r.HandleFunc("/api/billing/custom-plan-requests/user/{userId}", h.CreateCustomPlanRequest).Methods("POST")
	r.HandleFunc("/api/billing/custom-plan-requests/admin/user/{userId}", h.GetCustomPlanRequests).Methods("GET")
	r.HandleFunc("/api/billing/custom-plan-requests/{requestId}/admin/user/{userId}", h.UpdateCustomPlanRequest).Methods("PUT")
	r.HandleFunc("/api/billing/custom-plan-requests/{requestId}/approve/admin/user/{userId}", h.ApproveCustomPlanRequest).Methods("POST")
	r.HandleFunc("/api/billing/subscription/fix-amount/admin/user/{userId}/target/{targetUserId}", h.FixSubscriptionAmount).Methods("POST")
	r.HandleFunc("/api/billing/subscription/user/{userId}", h.GetUserSubscription).Methods("GET")
	r.HandleFunc("/api/billing/subscription/user/{userId}", h.CreateSubscription).Methods("POST")
	r.HandleFunc("/api/billing/subscription/cancel/user/{userId}", h.CancelSubscription).Methods("POST")
	r.HandleFunc("/api/billing/invoices/user/{userId}", h.GetUserInvoices).Methods("GET")

	// Stripe webhook endpoint - the one you requested!
	r.HandleFunc("/webhook/stripe", h.StripeWebhook).Methods("POST")
	r.HandleFunc("/webhook/stripe/snapshot", h.StripeWebhook).Methods("POST")
	r.HandleFunc("/webhook/stripe/thin", h.StripeWebhook).Methods("POST")

	// Sync endpoints for Stripe integration
	r.HandleFunc("/api/billing/sync/products", h.SyncStripeProducts).Methods("POST")
	r.HandleFunc("/api/billing/sync/plans", h.SyncStripePlans).Methods("POST")

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
	r.HandleFunc("/api/uploads/folders/user/{userId}", h.ListUploadFoldersForUser).Methods("GET")
	r.HandleFunc("/api/video-editor/export/user/{userId}", h.ExportVideoEditor).Methods("POST")

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
