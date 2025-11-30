package socialimport

import (
	"context"
	"os"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestUpper(t *testing.T) {
	if upper("instagram") != "INSTAGRAM" {
		t.Fatalf("upper mismatch")
	}
	if upper("my-provider") != "MY_PROVIDER" {
		t.Fatalf("dash should become underscore")
	}
}

func TestRateLimitFromEnv(t *testing.T) {
	os.Setenv("SOCIAL_IMPORT_X_RPS", "0.5")
	os.Setenv("SOCIAL_IMPORT_X_BURST", "3")
	os.Setenv("SOCIAL_IMPORT_X_DAILY_MAX", "10")
	t.Cleanup(func() {
		os.Unsetenv("SOCIAL_IMPORT_X_RPS")
		os.Unsetenv("SOCIAL_IMPORT_X_BURST")
		os.Unsetenv("SOCIAL_IMPORT_X_DAILY_MAX")
	})

	cfg := rateLimitFromEnv("x", RateLimitConfig{RequestsPerSecond: 1, Burst: 1, DailyRequestsMax: 0})
	if cfg.RequestsPerSecond != 0.5 || cfg.Burst != 3 || cfg.DailyRequestsMax != 10 {
		t.Fatalf("unexpected cfg: %+v", cfg)
	}
}

func TestRunnerEnsureDefaultsAndLimiter(t *testing.T) {
	var r Runner
	r.EnsureDefaults()
	if r.Client == nil || r.Logger == nil {
		t.Fatalf("expected defaults set")
	}
	lim, cfg := r.limiterForProvider("instagram")
	if lim == nil || cfg.Burst == 0 {
		t.Fatalf("expected limiter and cfg")
	}
}

func TestConsumeRequests_OK_Exceeded_Error(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	// ok path
	mock.ExpectQuery(`INSERT INTO public\."SocialImportUsage"`).
		WithArgs(sqlmock.AnyArg(), "x", sqlmock.AnyArg(), int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{"requests_used"}).AddRow(int64(1)))
	ok, used, err := ConsumeRequests(context.Background(), db, "x", 1, 10)
	if err != nil || !ok || used != 1 {
		t.Fatalf("unexpected ok path: ok=%v used=%d err=%v", ok, used, err)
	}

	// exceeded path (no error, ok=false)
	mock.ExpectQuery(`INSERT INTO public\."SocialImportUsage"`).
		WithArgs(sqlmock.AnyArg(), "x", sqlmock.AnyArg(), int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"requests_used"}).AddRow(int64(11)))
	ok, used, err = ConsumeRequests(context.Background(), db, "x", 10, 10)
	if err != nil || ok || used != 11 {
		t.Fatalf("unexpected exceeded path: ok=%v used=%d err=%v", ok, used, err)
	}

	// error path
	mock.ExpectQuery(`INSERT INTO public\."SocialImportUsage"`).
		WillReturnError(sqlmock.ErrCancelled)
	_, _, err = ConsumeRequests(context.Background(), db, "x", 1, 10)
	if err == nil {
		t.Fatalf("expected error")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
