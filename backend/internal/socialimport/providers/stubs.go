package providers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"

	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"golang.org/x/time/rate"
)

// Stub providers for networks that require additional credentials/app review and will be implemented incrementally.

type YouTubeProvider struct{}

func (p YouTubeProvider) Name() string { return "youtube" }
func (p YouTubeProvider) SyncUser(ctx context.Context, _ *sql.DB, userID string, _ *http.Client, _ *rate.Limiter, logger *log.Logger) (int, int, error) {
	if logger != nil {
		logger.Printf("[YTImport] not implemented yet userId=%s", userID)
	}
	return 0, 0, nil
}

type XProvider struct{}

func (p XProvider) Name() string { return "x" }
func (p XProvider) SyncUser(ctx context.Context, _ *sql.DB, userID string, _ *http.Client, _ *rate.Limiter, logger *log.Logger) (int, int, error) {
	if logger != nil {
		logger.Printf("[XImport] not implemented yet userId=%s", userID)
	}
	return 0, 0, nil
}

type PinterestProvider struct{}

func (p PinterestProvider) Name() string { return "pinterest" }
func (p PinterestProvider) SyncUser(ctx context.Context, _ *sql.DB, userID string, _ *http.Client, _ *rate.Limiter, logger *log.Logger) (int, int, error) {
	if logger != nil {
		logger.Printf("[PinterestImport] not implemented yet userId=%s", userID)
	}
	return 0, 0, nil
}

type ThreadsProvider struct{}

func (p ThreadsProvider) Name() string { return "threads" }
func (p ThreadsProvider) SyncUser(ctx context.Context, _ *sql.DB, userID string, _ *http.Client, _ *rate.Limiter, logger *log.Logger) (int, int, error) {
	if logger != nil {
		logger.Printf("[ThreadsImport] not implemented yet userId=%s", userID)
	}
	return 0, 0, nil
}

// Ensure they satisfy the interface.
var (
	_ socialimport.Provider = YouTubeProvider{}
	_ socialimport.Provider = XProvider{}
	_ socialimport.Provider = PinterestProvider{}
	_ socialimport.Provider = ThreadsProvider{}
)

func _unused(ctx context.Context) error { return fmt.Errorf("%v", ctx.Err()) }
