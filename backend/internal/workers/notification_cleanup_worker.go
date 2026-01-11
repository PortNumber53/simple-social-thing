package workers

import (
	"context"
	"database/sql"
	"log"
	"time"
)

// NotificationCleanupWorker removes read notifications older than the configured retention period.
type NotificationCleanupWorker struct {
	DB              *sql.DB
	RetentionHours  int // How long to keep read notifications (default: 24)
	CheckIntervalMs int // How often to run cleanup (default: 3600000 = 1 hour)
}

// Start begins the notification cleanup worker loop.
func (w *NotificationCleanupWorker) Start(ctx context.Context) {
	if w.RetentionHours <= 0 {
		w.RetentionHours = 24
	}
	if w.CheckIntervalMs <= 0 {
		w.CheckIntervalMs = 3600000 // 1 hour
	}

	ticker := time.NewTicker(time.Duration(w.CheckIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	log.Printf("[NotificationCleanupWorker] started (retention=%dh, interval=%dms)", w.RetentionHours, w.CheckIntervalMs)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[NotificationCleanupWorker] stopped")
			return
		case <-ticker.C:
			w.cleanup(ctx)
		}
	}
}

// cleanup removes read notifications older than the retention period.
func (w *NotificationCleanupWorker) cleanup(ctx context.Context) {
	cutoffTime := time.Now().Add(-time.Duration(w.RetentionHours) * time.Hour)

	result, err := w.DB.ExecContext(ctx, `
		DELETE FROM public.notifications
		WHERE read_at IS NOT NULL
		AND read_at < $1
	`, cutoffTime)

	if err != nil {
		log.Printf("[NotificationCleanupWorker] error: %v", err)
		return
	}

	deleted, err := result.RowsAffected()
	if err != nil {
		log.Printf("[NotificationCleanupWorker] error getting rows affected: %v", err)
		return
	}

	if deleted > 0 {
		log.Printf("[NotificationCleanupWorker] deleted %d old read notifications", deleted)
	}
}
