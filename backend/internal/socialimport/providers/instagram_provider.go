package providers

import (
	"context"
	"database/sql"
	"log"
	"net/http"

	"github.com/PortNumber53/simple-social-thing/backend/internal/instagram"
	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"golang.org/x/time/rate"
)

type InstagramProvider struct{}

func (p InstagramProvider) Name() string { return "instagram" }

func (p InstagramProvider) SyncUser(ctx context.Context, db *sql.DB, userID string, _ *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
	// Limit one “unit” for the Graph call batch; fine-grained accounting happens in provider implementations later.
	if limiter != nil {
		if err := limiter.Wait(ctx); err != nil {
			return 0, 0, err
		}
	}
	return instagram.SyncUser(ctx, db, userID, logger)
}

var _ socialimport.Provider = InstagramProvider{}
