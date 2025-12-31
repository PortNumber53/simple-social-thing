package socialimport

import (
	"context"
	"log"
	"time"
)

type ProviderRunResult struct {
	Provider string
	Fetched  int
	Upserted int
	Skipped  bool
	Reason   string
	Error    string
}

// SyncAll does an on-demand import for a set of providers for a single user.
func (r *Runner) SyncAll(ctx context.Context, userID string, providers []Provider) []ProviderRunResult {
	r.EnsureDefaults()
	out := make([]ProviderRunResult, 0, len(providers))
	for _, p := range providers {
		name := p.Name()
		lim, cfg := r.limiterForProvider(name)
		start := time.Now()
		r.Logger.Printf("[SocialSync] start provider=%s userId=%s", name, userID)

		// One request "budget" for the sync attempt itself; providers should account for their internal calls too.
		if r.DB != nil && cfg.DailyRequestsMax > 0 {
			ok, used, err := ConsumeRequests(ctx, r.DB, name, 1, cfg.DailyRequestsMax)
			if err != nil {
				out = append(out, ProviderRunResult{Provider: name, Error: err.Error()})
				r.Logger.Printf("[SocialSync] quota check failed provider=%s userId=%s err=%v", name, userID, err)
				continue
			}
			if !ok {
				out = append(out, ProviderRunResult{Provider: name, Skipped: true, Reason: "daily_quota_exceeded"})
				r.Logger.Printf("[SocialSync] quota exceeded provider=%s userId=%s used=%d max=%d", name, userID, used, cfg.DailyRequestsMax)
				continue
			}
		}

		fetched, upserted, err := p.SyncUser(ctx, r.DB, userID, r.Client, lim, r.Logger)
		if err != nil {
			out = append(out, ProviderRunResult{Provider: name, Fetched: fetched, Upserted: upserted, Error: err.Error()})
			r.Logger.Printf("[SocialSync] error provider=%s userId=%s fetched=%d upserted=%d dur=%s err=%v", name, userID, fetched, upserted, time.Since(start), err)
			continue
		}
		out = append(out, ProviderRunResult{Provider: name, Fetched: fetched, Upserted: upserted})
		r.Logger.Printf("[SocialSync] done provider=%s userId=%s fetched=%d upserted=%d dur=%s", name, userID, fetched, upserted, time.Since(start))
	}
	return out
}

// StartProviderWorker runs a periodic importer loop for a single provider with its own limiter/quota settings.
func (r *Runner) StartProviderWorker(ctx context.Context, provider Provider, interval time.Duration) {
	r.EnsureDefaults()
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	name := provider.Name()
	_, cfg := r.limiterForProvider(name)
	r.Logger.Printf("[SocialWorker] started provider=%s interval=%s rps=%.3f burst=%d dailyMax=%d", name, interval, cfg.RequestsPerSecond, cfg.Burst, cfg.DailyRequestsMax)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	run := func() {
		if r.DB == nil {
			return
		}
		// Find users that have an oauth token for that provider in UserSettings.
		key := name + "_oauth"
		rows, err := r.DB.QueryContext(ctx, `SELECT DISTINCT user_id FROM public.user_settings WHERE key = $1 AND value IS NOT NULL`, key)
		if err != nil {
			r.Logger.Printf("[SocialWorker] list users failed provider=%s err=%v", name, err)
			return
		}
		defer rows.Close()

		countUsers := 0
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				continue
			}
			countUsers++
			// Per user run uses its own internal accounting/logging
			_ = r.SyncAll(ctx, userID, []Provider{provider})
		}
		r.Logger.Printf("[SocialWorker] sweep complete provider=%s users=%d", name, countUsers)
	}

	run()
	for {
		select {
		case <-ctx.Done():
			if r.Logger == nil {
				log.Default().Printf("[SocialWorker] stopped provider=%s err=%v", name, ctx.Err())
			} else {
				r.Logger.Printf("[SocialWorker] stopped provider=%s err=%v", name, ctx.Err())
			}
			return
		case <-ticker.C:
			run()
		}
	}
}
