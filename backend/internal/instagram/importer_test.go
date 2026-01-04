package instagram

import (
	"context"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSyncUser_DBNil(t *testing.T) {
	_, _, err := SyncUser(context.Background(), nil, "u1", nil)
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestSyncUser_UserIDRequired(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	_, _, err = SyncUser(context.Background(), db, "", nil)
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestSyncUser_NoSettingsRow_ReturnsNil(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	q := `SELECT value FROM public.user_settings WHERE user_id = $1 AND key = 'instagram_oauth' AND value IS NOT NULL`
	mock.ExpectQuery(regexp.QuoteMeta(q)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"})) // no rows -> sql.ErrNoRows

	fetched, upserted, err := SyncUser(context.Background(), db, "u1", log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestSyncUser_InvalidOAuthJSON_IsIgnored(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	q := `SELECT value FROM public.user_settings WHERE user_id = $1 AND key = 'instagram_oauth' AND value IS NOT NULL`
	mock.ExpectQuery(regexp.QuoteMeta(q)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte("{nope")))

	fetched, upserted, err := SyncUser(context.Background(), db, "u1", log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestSyncUserWithClient_Success_Upserts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	q := `SELECT value FROM public.user_settings WHERE user_id = $1 AND key = 'instagram_oauth' AND value IS NOT NULL`
	mock.ExpectQuery(regexp.QuoteMeta(q)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t","igBusinessId":"ig","username":"x"}`)))

	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"data":[{"id":"m1","caption":"hi","media_type":"IMAGE","permalink":"p1","media_url":"u1","timestamp":"2024-01-02T03:04:05Z","like_count":1}]}`)),
			}, nil
		}),
	}

	execRe := `INSERT INTO public\.social_libraries`
	mock.ExpectExec(execRe).
		WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), "p1", "u1", "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "m1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	fetched, upserted, err := syncUserWithClient(context.Background(), db, "u1", log.New(io.Discard, "", 0), client)
	if err != nil {
		t.Fatalf("syncUserWithClient: %v", err)
	}
	if fetched != 1 || upserted != 1 {
		t.Fatalf("expected 1/1, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestImporter_fetchRecentMedia_Non2xx(t *testing.T) {
	imp := &Importer{
		Client: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 500,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(`{"error":"nope"}`)),
				}, nil
			}),
		},
	}

	_, raw, err := imp.fetchRecentMedia(context.Background(), "ig", "token")
	if err == nil {
		t.Fatalf("expected error")
	}
	if string(raw) == "" {
		t.Fatalf("expected raw body")
	}
}

func TestImporter_fetchRecentMedia_OK(t *testing.T) {
	imp := &Importer{
		Client: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 200,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(`{"data":[{"id":"m1","media_type":"IMAGE","timestamp":"2024-01-02T03:04:05Z"}]}`)),
				}, nil
			}),
		},
	}

	items, raw, err := imp.fetchRecentMedia(context.Background(), "ig", "token")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if len(items) != 1 || items[0].ID != "m1" {
		t.Fatalf("unexpected items: %#v", items)
	}
	if len(raw) == 0 {
		t.Fatalf("expected raw payload")
	}
}

func TestImporter_loadTokens_FiltersBadRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT user_id, value`).
		WillReturnRows(
			sqlmock.NewRows([]string{"user_id", "value"}).
				AddRow("u_bad_json", []byte("{nope")).
				AddRow("u_null", []byte("null")).
				AddRow("u_missing", []byte(`{"accessToken":"t"}`)).
				AddRow("u_ok", []byte(`{"accessToken":"t","igBusinessId":"ig123"}`)),
		)

	imp := &Importer{DB: db}
	rows, err := imp.loadTokens(context.Background())
	if err != nil {
		t.Fatalf("loadTokens: %v", err)
	}
	if len(rows) != 1 || rows[0].UserID != "u_ok" {
		t.Fatalf("unexpected rows: %#v", rows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestImporter_importForUser_Upserts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	imp := &Importer{
		DB: db,
		Client: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				// return 2 media items
				return &http.Response{
					StatusCode: 200,
					Header:     make(http.Header),
					Body: io.NopCloser(strings.NewReader(`{"data":[
						{"id":"m1","caption":" hi ","media_type":"IMAGE","permalink":"p1","media_url":"u1","thumbnail_url":"","timestamp":"2024-01-02T03:04:05Z","like_count":7},
						{"id":"m2","caption":"","media_type":"VIDEO","permalink":"p2","media_url":"u2","thumbnail_url":"t2","timestamp":"2024-01-02T03:04:06Z"}
					]}`)),
				}, nil
			}),
		},
	}

	// Expect 2 upserts
	execRe := `INSERT INTO public\.social_libraries`
	mock.ExpectExec(execRe).
		WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), "p1", "u1", "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "m1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(execRe).
		WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), "p2", "u2", "t2", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "m2").
		WillReturnResult(sqlmock.NewResult(1, 1))

	tok := oauthRecord{AccessToken: "t", IGBusinessID: "ig"}
	n, err := imp.importForUser(context.Background(), "u1", tok, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("importForUser: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2, got %d", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLogSchemaInfo(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	imp := &Importer{DB: db}
	imp.logSchemaInfo(context.Background(), log.New(io.Discard, "", 0))

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLogSchemaInfo_QueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS`).
		WillReturnError(io.ErrUnexpectedEOF)

	imp := &Importer{DB: db}
	imp.logSchemaInfo(context.Background(), log.New(io.Discard, "", 0))

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestImporter_Start_StopsOnCancel(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	// logSchemaInfo
	mock.ExpectQuery(`SELECT EXISTS`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	// loadTokens
	mock.ExpectQuery(`SELECT user_id, value`).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "value"}))

	imp := &Importer{
		DB:       db,
		Interval: 0, // exercise default interval branch
		Logger:   log.New(io.Discard, "", 0),
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		imp.Start(ctx)
		close(done)
	}()

	time.Sleep(10 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(250 * time.Millisecond):
		t.Fatalf("Start did not stop after cancel")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestImporter_runOnce_ImportsOneUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	// loadTokens returns one valid row
	mock.ExpectQuery(`SELECT user_id, value`).
		WillReturnRows(
			sqlmock.NewRows([]string{"user_id", "value"}).
				AddRow("u1", []byte(`{"accessToken":"t","igBusinessId":"ig","expiresAt":"never"}`)),
		)

	imp := &Importer{
		DB: db,
		Client: &http.Client{
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 200,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(`{"data":[]}`)),
				}, nil
			}),
		},
	}

	imp.runOnce(context.Background(), log.New(io.Discard, "", 0))

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestHelpers(t *testing.T) {
	if got := mapMediaType("IMAGE"); got != "post" {
		t.Fatalf("expected post, got %q", got)
	}
	if got := mapMediaType("video"); got != "video" {
		t.Fatalf("expected video, got %q", got)
	}
	if got := mapMediaType("OTHER"); got != "other" {
		t.Fatalf("expected other, got %q", got)
	}
	if got := normalizeTitle("  hi "); got != "hi" {
		t.Fatalf("expected hi, got %q", got)
	}
	long := strings.Repeat("a", 200)
	if got := normalizeTitle(long); len(got) != 160 {
		t.Fatalf("expected 160, got %d", len(got))
	}
	if got := truncate("abc", 2); got != "ab" {
		t.Fatalf("expected ab, got %q", got)
	}
	if parseIGTimestamp("") != nil {
		t.Fatalf("expected nil timestamp")
	}
	if parseIGTimestamp("not-a-time") != nil {
		t.Fatalf("expected nil for invalid timestamp")
	}
	if ts := parseIGTimestamp(time.Now().UTC().Format(time.RFC3339)); ts == nil {
		t.Fatalf("expected timestamp")
	}
	// IG may return offsets without a colon (e.g. +0000).
	if ts := parseIGTimestamp("2024-01-02T03:04:05+0000"); ts == nil {
		t.Fatalf("expected timestamp for +0000 offset")
	}
	// And fractional seconds.
	if ts := parseIGTimestamp("2024-01-02T03:04:05.123+0000"); ts == nil {
		t.Fatalf("expected timestamp for fractional seconds +0000 offset")
	}
	// And standard +00:00 offset.
	if ts := parseIGTimestamp("2024-01-02T03:04:05+00:00"); ts == nil {
		t.Fatalf("expected timestamp for +00:00 offset")
	}
}
