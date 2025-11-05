package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/handlers"
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

	// Team endpoints
	r.HandleFunc("/api/teams", h.CreateTeam).Methods("POST")
	r.HandleFunc("/api/teams/{id}", h.GetTeam).Methods("GET")
	r.HandleFunc("/api/teams/user/{userId}", h.GetUserTeams).Methods("GET")

	// Suno integration endpoints
	r.HandleFunc("/api/suno/store", h.StoreSunoTrack).Methods("POST")

	// User settings (for per-user Suno API keys)
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
		port = "18002"
	}

	srv := &http.Server{
		Handler:      handler,
		Addr:         ":" + port,
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	log.Printf("Server starting on port %s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
