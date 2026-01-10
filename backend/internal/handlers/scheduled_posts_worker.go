package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
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
		scheduledFor time.Time
	}

	// Use an ordering that matches the partial index to avoid large sorts that can trigger OOMs.
	rows, err := h.db.QueryContext(ctx, `
		SELECT id, user_id, scheduled_for
		  FROM public.posts
		 WHERE status = 'scheduled'
		   AND published_at IS NULL
		   AND scheduled_for IS NOT NULL
		   AND scheduled_for <= NOW()
		   AND last_publish_job_id IS NULL
		 ORDER BY scheduled_for ASC, user_id, id
		 LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	cands := make([]cand, 0)
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.id, &c.userID, &c.scheduledFor); err != nil {
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

		log.Printf("[ScheduledPosts] candidate postId=%s userId=%s scheduledFor=%s",
			c.id, c.userID, c.scheduledFor.UTC().Format(time.RFC3339))

		// Try to claim atomically (prevents multiple app instances from enqueuing the same post).
		res, err := h.db.ExecContext(ctx, `
			UPDATE public.posts
			   SET last_publish_job_id = $3,
			       last_publish_status = 'queued',
			       last_publish_error = NULL,
			       last_publish_attempt_at = NOW(),
			       updated_at = NOW()
			 WHERE id = $1
			   AND user_id = $2
			   AND status = 'scheduled'
			   AND published_at IS NULL
			   AND scheduled_for IS NOT NULL
			   AND scheduled_for <= NOW()
			   AND last_publish_job_id IS NULL
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

		// Load the (potentially large) publish fields only after we claim, to avoid forcing Postgres
		// to detoast big columns for a wide scan.
		var content sql.NullString
		var providers []string
		var media []string
		var scheduledFor time.Time
		if err := h.db.QueryRowContext(ctx, `
			SELECT content,
			       COALESCE(providers, ARRAY[]::text[]),
			       COALESCE(media, ARRAY[]::text[]),
			       scheduled_for
			  FROM public.posts
			 WHERE id = $1
			   AND user_id = $2
			   AND last_publish_job_id = $3
		`, c.id, c.userID, jobID).Scan(&content, pq.Array(&providers), pq.Array(&media), &scheduledFor); err != nil {
			reason := "load_failed"
			if strings.Contains(strings.ToLower(err.Error()), "out of memory") {
				reason = "db_out_of_memory"
			}
			_, _ = h.db.ExecContext(ctx, `
				UPDATE public.posts
				   SET last_publish_status='failed',
				       last_publish_error=$4,
				       updated_at=NOW()
				 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
			`, c.id, c.userID, jobID, reason)
			log.Printf("[ScheduledPosts] load_failed postId=%s userId=%s jobId=%s err=%v", c.id, c.userID, jobID, err)
			continue
		}

		caption := strings.TrimSpace(content.String)
		if caption == "" {
			// Don't enqueue a publish job; mark as failed (user can edit to clear this state).
			_, _ = h.db.ExecContext(ctx, `
				UPDATE public.posts
				   SET last_publish_status='failed',
				       last_publish_error='empty_content',
				       updated_at=NOW()
				 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
			`, c.id, c.userID, jobID)
			log.Printf("[ScheduledPosts] skipped postId=%s userId=%s jobId=%s reason=empty_content", c.id, c.userID, jobID)
			continue
		}
		if len(providers) == 0 {
			_, _ = h.db.ExecContext(ctx, `
				UPDATE public.posts
				   SET last_publish_status='failed',
				       last_publish_error='missing_providers',
				       updated_at=NOW()
				 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
			`, c.id, c.userID, jobID)
			log.Printf("[ScheduledPosts] skipped postId=%s userId=%s jobId=%s reason=missing_providers", c.id, c.userID, jobID)
			continue
		}
		if len(media) == 0 {
			requires := false
			for _, p := range providers {
				switch p {
				case "instagram", "pinterest", "tiktok", "youtube":
					requires = true
				}
			}
			if requires {
				_, _ = h.db.ExecContext(ctx, `
					UPDATE public.posts
					   SET last_publish_status='failed',
					       last_publish_error='missing_media',
					       updated_at=NOW()
					 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
				`, c.id, c.userID, jobID)
				log.Printf("[ScheduledPosts] skipped postId=%s userId=%s jobId=%s reason=missing_media", c.id, c.userID, jobID)
				continue
			}
		}

		reqSnapshot := map[string]interface{}{
			"source":       "scheduled_post",
			"postId":       c.id,
			"userId":       c.userID,
			"providers":    providers,
			"media":        media,
			"scheduledFor": scheduledFor.UTC().Format(time.RFC3339),
			"publicOrigin": origin,
		}
		reqJSON, _ := json.Marshal(reqSnapshot)
		now := time.Now()

		_, err = h.db.ExecContext(ctx, `
			INSERT INTO public.publish_jobs
			  (id, user_id, status, providers, caption, request_json, created_at, updated_at)
			VALUES
			  ($1, $2, 'queued', $3, $4, $5::jsonb, $6, $6)
		`, jobID, c.userID, pq.Array(providers), caption, string(reqJSON), now)
		if err != nil {
			// Undo claim so it can be retried (nothing published yet).
			_, _ = h.db.ExecContext(ctx, `
				UPDATE public.posts
				   SET last_publish_job_id=NULL,
				       last_publish_status=NULL,
				       last_publish_error=$4,
				       last_publish_attempt_at=NULL,
				       updated_at=NOW()
				 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
			`, c.id, c.userID, jobID, truncate(err.Error(), 300))
			log.Printf("[ScheduledPosts] enqueue_failed postId=%s userId=%s jobId=%s err=%v", c.id, c.userID, jobID, err)
			continue
		}

		enqueued++
		log.Printf("[ScheduledPosts] enqueued_one postId=%s userId=%s jobId=%s providers=%v media=%d", c.id, c.userID, jobID, providers, len(media))
		// Realtime: let the UI know this post started processing (queued).
		h.emitEvent(c.userID, realtimeEvent{
			Type:   "post.updated",
			PostID: c.id,
			JobID:  jobID,
			Status: "queued",
			At:     time.Now().UTC().Format(time.RFC3339),
		})
		startJob(jobID, c.userID, caption, providers, media)
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
		// Try to read from environment variable
		origin = strings.TrimSpace(os.Getenv("PUBLIC_ORIGIN"))
		if origin == "" {
			origin = "http://localhost"
			log.Printf("[ScheduledPosts] CRITICAL: PUBLIC_ORIGIN environment variable is not set and no origin was provided. Using localhost as fallback, but this will cause Instagram publishing to fail. Set PUBLIC_ORIGIN to your public https origin (e.g., https://app.example.com)")
		}
	}
	log.Printf("[ScheduledPosts] worker started interval=%s origin=%s", interval, origin)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Persist sweep limit across runs so we can permanently back off on OOMs.
	sweepLimit := 25

	// Log a lightweight summary periodically even when nothing is due.
	sweepCount := 0
	sweepStats := func() (due int, next sql.NullTime) {
		if h == nil || h.db == nil {
			return 0, sql.NullTime{}
		}
		_ = h.db.QueryRowContext(ctx, `
			SELECT COUNT(*)
			  FROM public.posts
			 WHERE status = 'scheduled'
			   AND published_at IS NULL
			   AND scheduled_for IS NOT NULL
			   AND scheduled_for <= NOW()
			   AND last_publish_job_id IS NULL
		`).Scan(&due)
		_ = h.db.QueryRowContext(ctx, `
			SELECT MIN(scheduled_for)
			  FROM public.posts
			 WHERE status = 'scheduled'
			   AND published_at IS NULL
			   AND scheduled_for IS NOT NULL
			   AND scheduled_for > NOW()
		`).Scan(&next)
		return due, next
	}

	run := func() {
		sweepCount++
		limit := sweepLimit
		backoffs := []time.Duration{700 * time.Millisecond, 1500 * time.Millisecond, 3 * time.Second}
		var n int
		var err error
		for attempt := 0; attempt < len(backoffs)+1; attempt++ {
			// Timebox each sweep attempt.
			sweepCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			n, err = h.processDueScheduledPostsOnce(sweepCtx, origin, limit, func(jobID, userID, caption string, providers []string, relMedia []string) {
				go h.runPublishJob(jobID, userID, caption, publishPostRequest{Providers: providers}, relMedia, origin)
			})
			cancel()
			if err == nil {
				break
			}
			// If the DB reports OOM, reduce the batch size to reduce pressure and avoid repeated failures.
			if strings.Contains(strings.ToLower(err.Error()), "out of memory") {
				if limit > 1 {
					limit = 1
				}
				if sweepLimit > limit {
					sweepLimit = limit
				}
			}
			if attempt < len(backoffs) {
				log.Printf("[ScheduledPosts] sweep error attempt=%d/%d limit=%d err=%v", attempt+1, len(backoffs)+1, limit, err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(backoffs[attempt]):
				}
				continue
			}
		}
		if err != nil {
			log.Printf("[ScheduledPosts] sweep error final limit=%d err=%v", limit, err)
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
