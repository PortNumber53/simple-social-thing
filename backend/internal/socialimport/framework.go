package socialimport

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"golang.org/x/time/rate"
)

type Provider interface {
	Name() string
	// SyncUser imports and upserts content into SocialLibraries for a single user.
	// Implementations should respect the provided limiter and use ConsumeRequests() for quota accounting.
	SyncUser(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (fetched int, upserted int, err error)
}

type Runner struct {
	DB     *sql.DB
	Client *http.Client
	Logger *log.Logger
}

type RateLimitConfig struct {
	RequestsPerSecond float64
	Burst             int
	DailyRequestsMax  int64 // 0 means unlimited
}

func DefaultRateLimits() map[string]RateLimitConfig {
	// Conservative defaults; override via env per provider to match each network’s quota policy.
	return map[string]RateLimitConfig{
		"instagram": {RequestsPerSecond: 1, Burst: 2, DailyRequestsMax: 0},
		"facebook":  {RequestsPerSecond: 1, Burst: 2, DailyRequestsMax: 0},
		"tiktok":    {RequestsPerSecond: 1, Burst: 2, DailyRequestsMax: 0},
		"youtube":   {RequestsPerSecond: 3, Burst: 3, DailyRequestsMax: 0},
		"x":         {RequestsPerSecond: 1, Burst: 1, DailyRequestsMax: 0},
		"pinterest": {RequestsPerSecond: 1, Burst: 2, DailyRequestsMax: 0},
		"threads":   {RequestsPerSecond: 1, Burst: 2, DailyRequestsMax: 0},
	}
}

func rateLimitFromEnv(provider string, def RateLimitConfig) RateLimitConfig {
	// Env vars, e.g.:
	// SOCIAL_IMPORT_INSTAGRAM_RPS=0.5
	// SOCIAL_IMPORT_INSTAGRAM_BURST=2
	// SOCIAL_IMPORT_INSTAGRAM_DAILY_MAX=10000
	prefix := "SOCIAL_IMPORT_" + upper(provider) + "_"
	if v := os.Getenv(prefix + "RPS"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			def.RequestsPerSecond = f
		}
	}
	if v := os.Getenv(prefix + "BURST"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			def.Burst = n
		}
	}
	if v := os.Getenv(prefix + "DAILY_MAX"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			def.DailyRequestsMax = n
		}
	}
	return def
}

func (r *Runner) EnsureDefaults() {
	if r.Client == nil {
		r.Client = &http.Client{Timeout: 20 * time.Second}
	}
	if r.Logger == nil {
		r.Logger = log.Default()
	}
}

func (r *Runner) limiterForProvider(provider string) (*rate.Limiter, RateLimitConfig) {
	cfg := DefaultRateLimits()[provider]
	cfg = rateLimitFromEnv(provider, cfg)
	lim := rate.NewLimiter(rate.Limit(cfg.RequestsPerSecond), cfg.Burst)
	return lim, cfg
}

// ConsumeRequests implements basic daily quota tracking. It returns ok=false when the daily max would be exceeded.
func ConsumeRequests(ctx context.Context, db *sql.DB, provider string, add int64, dailyMax int64) (ok bool, used int64, err error) {
	if add <= 0 {
		return true, 0, nil
	}
	// If no max, we just increment and continue.
	day := time.Now().UTC().Format("2006-01-02")
	id := fmt.Sprintf("%s:%s", provider, day)
	query := `
		INSERT INTO public."SocialImportUsage" (id, provider, day, requests_used, last_updated_at)
		VALUES ($1, $2, $3::date, $4, NOW())
		ON CONFLICT (provider, day) DO UPDATE SET
		  requests_used = public."SocialImportUsage".requests_used + EXCLUDED.requests_used,
		  last_updated_at = NOW()
		RETURNING requests_used
	`
	var newUsed int64
	if err := db.QueryRowContext(ctx, query, id, provider, day, add).Scan(&newUsed); err != nil {
		return false, 0, err
	}
	if dailyMax > 0 && newUsed > dailyMax {
		return false, newUsed, nil
	}
	return true, newUsed, nil
}

func upper(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			out = append(out, c-32)
		} else if c == '-' {
			out = append(out, '_')
		} else {
			out = append(out, c)
		}
	}
	return string(out)
}
