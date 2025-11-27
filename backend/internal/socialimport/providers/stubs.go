package providers

import (
	"context"
	"database/sql"
	"log"
	"net/http"

	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"golang.org/x/time/rate"
)

// Stub providers for networks that require additional credentials/app review and will be implemented incrementally.

type XProvider struct{}

func (p XProvider) Name() string { return "x" }
func (p XProvider) SyncUser(ctx context.Context, _ *sql.DB, userID string, _ *http.Client, _ *rate.Limiter, logger *log.Logger) (int, int, error) {
	if logger != nil {
		logger.Printf("[XImport] not implemented yet userId=%s", userID)
	}
	return 0, 0, nil
}

// Ensure they satisfy the interface.
var (
	_ socialimport.Provider = XProvider{}
)
