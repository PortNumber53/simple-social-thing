package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/PortNumber53/simple-social-thing/backend/internal/handlers"
)

func TestResolvePort_Default(t *testing.T) {
	got := resolvePort(func(string) string { return "" })
	if got != "18911" {
		t.Fatalf("expected default port 18911, got %q", got)
	}
}

func TestResolvePort_FromEnv(t *testing.T) {
	got := resolvePort(func(k string) string {
		if k == "PORT" {
			return "12345"
		}
		return ""
	})
	if got != "12345" {
		t.Fatalf("expected port 12345, got %q", got)
	}
}

func TestParseIntervalFromEnv(t *testing.T) {
	def := 7 * time.Second

	if got := parseIntervalFromEnv(func(string) string { return "" }, "X", def); got != def {
		t.Fatalf("expected default, got %s", got)
	}
	if got := parseIntervalFromEnv(func(string) string { return "0" }, "X", def); got != def {
		t.Fatalf("expected default on 0, got %s", got)
	}
	if got := parseIntervalFromEnv(func(string) string { return "-1" }, "X", def); got != def {
		t.Fatalf("expected default on -1, got %s", got)
	}
	if got := parseIntervalFromEnv(func(string) string { return "abc" }, "X", def); got != def {
		t.Fatalf("expected default on non-int, got %s", got)
	}
	if got := parseIntervalFromEnv(func(string) string { return "3" }, "X", def); got != 3*time.Second {
		t.Fatalf("expected 3s, got %s", got)
	}
}

func TestBuildRouter_HealthOK(t *testing.T) {
	r := buildRouter(handlers.New(nil))

	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if body := rr.Body.String(); body == "" || body[0] != '{' {
		t.Fatalf("expected json response, got %q", body)
	}
}

func TestRun_Smoke_NoRealListen(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectPing()

	stop := make(chan os.Signal, 1)
	stop <- os.Interrupt

	d := deps{
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			// keep workers disabled for deterministic tests
			return ""
		},
		openDB: func(driverName, dataSourceName string) (*sql.DB, error) {
			_ = driverName
			_ = dataSourceName
			return db, nil
		},
		migrateUp: func(*sql.DB) error { return nil },
		listenAndServe: func(*http.Server) error {
			// simulate a clean shutdown
			return http.ErrServerClosed
		},
		stopCh: stop,
	}

	if err := run(d); err != nil {
		t.Fatalf("run returned error: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestDefaultDeps_HasRequiredFields(t *testing.T) {
	d := defaultDeps()
	if d.getenv == nil || d.openDB == nil || d.migrateUp == nil || d.listenAndServe == nil || d.notify == nil {
		t.Fatalf("expected all default deps to be non-nil: %#v", d)
	}
}

func TestStartSocialImportWorkersIfEnabled_EnabledButCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // ensure workers exit immediately

	startSocialImportWorkersIfEnabled(ctx, nil, func(k string) string {
		switch k {
		case "SOCIAL_IMPORT_WORKERS_ENABLED":
			return "true"
		case "SOCIAL_IMPORT_INSTAGRAM_INTERVAL_SECONDS":
			return "1"
		default:
			return ""
		}
	})
}

func TestRun_MissingOpenDB(t *testing.T) {
	err := run(deps{
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			return ""
		},
		openDB:         nil,
		listenAndServe: func(*http.Server) error { return http.ErrServerClosed },
	})
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestMigrateUp_NilDB(t *testing.T) {
	if err := migrateUp(nil); err == nil {
		t.Fatalf("expected error")
	}
}
