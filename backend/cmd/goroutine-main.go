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
	_ "github.com/lib/pq"
)

func main() {
	// Initialize database
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://localhost/simple_social?sslmode=disable"
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Test database connection
	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	// Create handler
	handler := handlers.New(db)

	// Create router with gorilla/mux
	router := http.NewServeMux()

	// Register routes
	registerRoutes(handler, router)

	// Create server
	server := &http.Server{
		Addr:    ":18911",
		Handler: router,
	}

	// Channel for graceful shutdown
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	// Start server in a goroutine
	go func() {
		log.Printf("Server starting on port 18911")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for interrupt signal
	<-done
	log.Println("Server shutting down...")

	// Create context with timeout for graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Gracefully shutdown the server
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

func registerRoutes(h *handlers.Handler, r *http.ServeMux) {
	// Health check
	r.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "OK")
	})

	// TODO: Add your existing routes here including webhook
	// For now, this is a basic structure - you'll need to add:
	// r.HandleFunc("/webhook/stripe", h.StripeWebhook)
	// r.HandleFunc("/api/billing/plans", h.GetBillingPlans)
	// etc.
}
