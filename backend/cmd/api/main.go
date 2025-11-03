package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/handlers"
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

	log.Println("Successfully connected to database")

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
