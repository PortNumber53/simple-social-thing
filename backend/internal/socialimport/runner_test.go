package socialimport

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"golang.org/x/time/rate"
)

type fakeProvider struct {
	name string
	fn   func(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error)
}

func (p fakeProvider) Name() string { return p.name }
func (p fakeProvider) SyncUser(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
	return p.fn(ctx, db, userID, client, limiter, logger)
}

func TestRunnerSyncAll_QuotaExceededAndProviderError(t *testing.T) {
	// Force daily max via env for provider x.
	os.Setenv("SOCIAL_IMPORT_X_DAILY_MAX", "1")
	t.Cleanup(func() { os.Unsetenv("SOCIAL_IMPORT_X_DAILY_MAX") })

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	r := &Runner{DB: db}

	// ConsumeRequests increments to 2 -> exceed max 1.
	mock.ExpectQuery(`INSERT INTO public\.social_import_usage`).
		WithArgs(sqlmock.AnyArg(), "x", sqlmock.AnyArg(), int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{"requests_used"}).AddRow(int64(2)))

	out := r.SyncAll(context.Background(), "u1", []Provider{
		fakeProvider{name: "x", fn: func(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
			return 1, 1, nil
		}},
	})
	if len(out) != 1 || !out[0].Skipped || out[0].Reason != "daily_quota_exceeded" {
		t.Fatalf("unexpected result: %+v", out)
	}

	// Provider error path (no DB quota when db=nil OR dailyMax=0). Use db=nil by setting r.DB nil.
	r.DB = nil
	out = r.SyncAll(context.Background(), "u1", []Provider{
		fakeProvider{name: "instagram", fn: func(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
			return 3, 0, errors.New("boom")
		}},
	})
	if len(out) != 1 || out[0].Error != "boom" || out[0].Fetched != 3 {
		t.Fatalf("unexpected provider error result: %+v", out)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestStartProviderWorker_StopsOnContextCancel(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	var calls atomic.Int32
	p := fakeProvider{name: "x", fn: func(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
		calls.Add(1)
		return 0, 0, nil
	}}

	// StartProviderWorker queries users from UserSettings for oauth key.
	mock.ExpectQuery(`SELECT DISTINCT user_id FROM public\."UserSettings" WHERE key = \$1 AND value IS NOT NULL`).
		WithArgs("x_oauth").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))

	ctx, cancel := context.WithCancel(context.Background())
	r := &Runner{DB: db, Logger: log.Default()}

	done := make(chan struct{})
	go func() {
		r.StartProviderWorker(ctx, p, 24*time.Hour) // long interval; run() is invoked immediately anyway
		close(done)
	}()

	// Allow initial run to complete, then stop.
	time.Sleep(20 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("worker did not stop")
	}

	if calls.Load() < 1 {
		t.Fatalf("expected provider called at least once")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
