package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/lib/pq"
)

type startPublishJobFunc func(jobID, userID, caption string, providers []string, relMedia []string)

// processDueScheduledPostsOnce claims due scheduled posts and enqueues a PublishJob per post.
//
// Claiming is done by setting Posts.lastPublishJobId so we don't enqueue duplicates across instances.
func (h *Handler) processDueScheduledPostsOnce(ctx context.Context, origin string, limit int, startJob startPublishJobFunc) (int, error) {
	if h == nil || h.db == nil {
		return 0, nil
	}
	if limit <= 0 {
		limit = 25
	}
	if startJob == nil {
		startJob = func(jobID, userID, caption string, providers []string, relMedia []string) {}
	}
	if strings.TrimSpace(origin) == "" {
		origin = "http://localhost"
	}

	type cand struct {
		id           string
		userID       string
		content      sql.NullString
		providers    []string
		media        []string
		scheduledFor time.Time
	}

	rows, err := h.db.QueryContext(ctx, `
		SELECT id, "userId", content, COALESCE(providers, ARRAY[]::text[]), COALESCE(media, ARRAY[]::text[]), "scheduledFor"
		  FROM public."Posts"
		 WHERE status = 'scheduled'
		   AND "publishedAt" IS NULL
		   AND "scheduledFor" IS NOT NULL
		   AND "scheduledFor" <= NOW()
		   AND "lastPublishJobId" IS NULL
		 ORDER BY "scheduledFor" ASC
		 LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	cands := make([]cand, 0)
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.id, &c.userID, &c.content, pq.Array(&c.providers), pq.Array(&c.media), &c.scheduledFor); err != nil {
			return 0, err
		}
		cands = append(cands, c)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(cands) == 0 {
		return 0, nil
	}

	enqueued := 0
	for _, c := range cands {
		jobID := fmt.Sprintf("pub_%s", randHex(12))

		log.Printf("[ScheduledPosts] candidate postId=%s userId=%s scheduledFor=%s providers=%v media=%d",
			c.id, c.userID, c.scheduledFor.UTC().Format(time.RFC3339), c.providers, len(c.media))

		// Try to claim atomically (prevents multiple app instances from enqueuing the same post).
		res, err := h.db.ExecContext(ctx, `
			UPDATE public."Posts"
			   SET "lastPublishJobId" = $3,
			       "lastPublishStatus" = 'queued',
			       "lastPublishError" = NULL,
			       "lastPublishAttemptAt" = NOW(),
			       "updatedAt" = NOW()
			 WHERE id = $1
			   AND "userId" = $2
			   AND status = 'scheduled'
			   AND "publishedAt" IS NULL
			   AND "scheduledFor" IS NOT NULL
			   AND "scheduledFor" <= NOW()
			   AND "lastPublishJobId" IS NULL
		`, c.id, c.userID, jobID)
		if err != nil {
			log.Printf("[ScheduledPosts] claim_failed postId=%s userId=%s err=%v", c.id, c.userID, err)
			continue
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			log.Printf("[ScheduledPosts] claim_skipped postId=%s userId=%s reason=not_due_or_already_claimed", c.id, c.userID)
			continue
		}

		caption := strings.TrimSpace(c.content.String)
		if caption == "" {
			// Don't enqueue a publish job; mark as failed (user can edit to clear this state).
			_, _ = h.db.ExecContext(ctx, `
				UPDATE public."Posts"
				   SET "lastPublishStatus"='failed',
				       "lastPublishError"='empty_content',
				       "updatedAt"=NOW()
				 WHERE id=$1 AND "userId"=$2 AND "lastPublishJobId"=$3
			`, c.id, c.userID, jobID)
			log.Printf("[ScheduledPosts] skipped postId=%s userId=%s jobId=%s reason=empty_content", c.id, c.userID, jobID)
			continue
		}
		if len(c.providers) == 0 {
			_, _ = h.db.ExecContext(ctx, `
				UPDATE public."Posts"
				   SET "lastPublishStatus"='failed',
				       "lastPublishError"='missing_providers',
				       "updatedAt"=NOW()
				 WHERE id=$1 AND "userId"=$2 AND "lastPublishJobId"=$3
			`, c.id, c.userID, jobID)
			log.Printf("[ScheduledPosts] skipped postId=%s userId=%s jobId=%s reason=missing_providers", c.id, c.userID, jobID)
			continue
		}
		if len(c.media) == 0 {
			requires := false
			for _, p := range c.providers {
				switch p {
				case "instagram", "pinterest", "tiktok", "youtube":
					requires = true
				}
			}
			if requires {
				_, _ = h.db.ExecContext(ctx, `
					UPDATE public."Posts"
					   SET "lastPublishStatus"='failed',
					       "lastPublishError"='missing_media',
					       "updatedAt"=NOW()
					 WHERE id=$1 AND "userId"=$2 AND "lastPublishJobId"=$3
				`, c.id, c.userID, jobID)
				log.Printf("[ScheduledPosts] skipped postId=%s userId=%s jobId=%s reason=missing_media", c.id, c.userID, jobID)
				continue
			}
		}

		reqSnapshot := map[string]interface{}{
			"source":       "scheduled_post",
			"postId":       c.id,
			"userId":       c.userID,
			"providers":    c.providers,
			"media":        c.media,
			"scheduledFor": c.scheduledFor.UTC().Format(time.RFC3339),
			"publicOrigin": origin,
		}
		reqJSON, _ := json.Marshal(reqSnapshot)
		now := time.Now()

		_, err = h.db.ExecContext(ctx, `
			INSERT INTO public."PublishJobs"
			  (id, user_id, status, providers, caption, request_json, created_at, updated_at)
			VALUES
			  ($1, $2, 'queued', $3, $4, $5::jsonb, $6, $6)
		`, jobID, c.userID, pq.Array(c.providers), caption, string(reqJSON), now)
		if err != nil {
			// Undo claim so it can be retried (nothing published yet).
			_, _ = h.db.ExecContext(ctx, `
				UPDATE public."Posts"
				   SET "lastPublishJobId"=NULL,
				       "lastPublishStatus"=NULL,
				       "lastPublishError"=$4,
				       "lastPublishAttemptAt"=NULL,
				       "updatedAt"=NOW()
				 WHERE id=$1 AND "userId"=$2 AND "lastPublishJobId"=$3
			`, c.id, c.userID, jobID, truncate(err.Error(), 300))
			log.Printf("[ScheduledPosts] enqueue_failed postId=%s userId=%s jobId=%s err=%v", c.id, c.userID, jobID, err)
			continue
		}

		enqueued++
		log.Printf("[ScheduledPosts] enqueued_one postId=%s userId=%s jobId=%s providers=%v media=%d", c.id, c.userID, jobID, c.providers, len(c.media))
		// Realtime: let the UI know this post started processing (queued).
		h.emitEvent(c.userID, realtimeEvent{
			Type:   "post.updated",
			PostID: c.id,
			JobID:  jobID,
			Status: "queued",
			At:     time.Now().UTC().Format(time.RFC3339),
		})
		startJob(jobID, c.userID, caption, c.providers, c.media)
	}

	return enqueued, nil
}

// StartScheduledPostsWorker runs a periodic poller that finds scheduled posts due for publishing and enqueues publish jobs.
// Enable it by wiring it from `main` using an env gate (recommended).
func (h *Handler) StartScheduledPostsWorker(ctx context.Context, interval time.Duration, origin string) {
	if interval <= 0 {
		interval = time.Minute
	}
	if strings.TrimSpace(origin) == "" {
		origin = "http://localhost"
		log.Printf("[ScheduledPosts] WARNING: PUBLIC_ORIGIN is empty; using origin=%s (set PUBLIC_ORIGIN to your public https origin for provider media fetches)", origin)
	}
	log.Printf("[ScheduledPosts] worker started interval=%s origin=%s", interval, origin)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Log a lightweight summary periodically even when nothing is due.
	sweepCount := 0
	sweepStats := func() (due int, next sql.NullTime) {
		if h == nil || h.db == nil {
			return 0, sql.NullTime{}
		}
		_ = h.db.QueryRowContext(ctx, `
			SELECT COUNT(*)
			  FROM public."Posts"
			 WHERE status = 'scheduled'
			   AND "publishedAt" IS NULL
			   AND "scheduledFor" IS NOT NULL
			   AND "scheduledFor" <= NOW()
			   AND "lastPublishJobId" IS NULL
		`).Scan(&due)
		_ = h.db.QueryRowContext(ctx, `
			SELECT MIN("scheduledFor")
			  FROM public."Posts"
			 WHERE status = 'scheduled'
			   AND "publishedAt" IS NULL
			   AND "scheduledFor" IS NOT NULL
			   AND "scheduledFor" > NOW()
		`).Scan(&next)
		return due, next
	}

	run := func() {
		sweepCount++
		n, err := h.processDueScheduledPostsOnce(ctx, origin, 25, func(jobID, userID, caption string, providers []string, relMedia []string) {
			go h.runPublishJob(jobID, userID, caption, publishPostRequest{Providers: providers}, relMedia, origin)
		})
		if err != nil {
			log.Printf("[ScheduledPosts] sweep error err=%v", err)
			return
		}
		if n > 0 {
			log.Printf("[ScheduledPosts] enqueued=%d", n)
			return
		}
		// Every ~10 sweeps, print a summary so "nothing happening" is diagnosable.
		if sweepCount%10 == 0 {
			due, next := sweepStats()
			nextStr := ""
			if next.Valid {
				nextStr = next.Time.UTC().Format(time.RFC3339)
			}
			log.Printf("[ScheduledPosts] sweep ok enqueued=0 due=%d next=%s", due, nextStr)
		}
	}

	run()
	for {
		select {
		case <-ctx.Done():
			log.Printf("[ScheduledPosts] worker stopped err=%v", ctx.Err())
			return
		case <-ticker.C:
			run()
		}
	}
}
