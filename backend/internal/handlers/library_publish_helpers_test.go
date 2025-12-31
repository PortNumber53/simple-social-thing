package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestListSocialLibrariesForUser_InvalidFrom(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/social-libraries/user/u1?from=nope", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestListSocialLibrariesForUser_InvalidLimitAndOffset(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/social-libraries/user/u1?limit=nope", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/social-libraries/user/u1?offset=nope", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestListAndDeleteSocialLibrariesForUser_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	from := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	toBase := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)
	to := toBase.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
	now := time.Now().UTC()

	mock.ExpectQuery(`FROM public\.social_libraries\s+WHERE user_id = \$1`).
		WithArgs("u1", "instagram", "post", from, to, "%hi%", 10, 5).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "user_id", "network", "content_type", "title", "permalink_url", "media_url", "thumbnail_url",
			"posted_at", "views", "likes", "raw_payload", "created_at", "updated_at",
		}).AddRow(
			"r1", "u1", "instagram", "post", sql.NullString{Valid: true, String: "t"}, sql.NullString{}, sql.NullString{}, sql.NullString{},
			sql.NullTime{Valid: true, Time: now}, sql.NullInt64{Valid: true, Int64: 1}, sql.NullInt64{Valid: false}, []byte(`{"x":1}`), now, now,
		))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/social-libraries/user/u1?network=instagram&type=post&q=hi&from=2025-01-01&to=2025-01-02&limit=10&offset=5", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	// DeleteSocialLibrariesForUser
	mock.ExpectQuery(`DELETE FROM public\.social_libraries WHERE user_id = \$1 AND id = ANY\(\$2\) RETURNING id`).
		WithArgs("u1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("a").AddRow("b"))

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/social-libraries/delete/user/u1", bytes.NewBufferString(`{"ids":["a","b","a"]}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.DeleteSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestSyncSocialLibrariesForUser_SelectNone(t *testing.T) {
	// providers=unknown => selected empty => runner does nothing, but handler exercises selection logic.
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-libraries/sync/user/u1?providers=unknown", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.SyncSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
}

func TestSyncSocialLibrariesForUser_XProvider(t *testing.T) {
	// providers=x selects the stub provider which runs without DB/network and yields an entry in response map.
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-libraries/sync/user/u1?providers=x", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.SyncSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	provAny := out["providers"]
	provMap, _ := provAny.(map[string]any)
	if provMap == nil || provMap["x"] == nil {
		t.Fatalf("expected providers.x present got %#v", out)
	}
}

func TestLoadUploadedMediaFromRelPaths_ContentTypeByExtension(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	// Write a file with .mp4 extension but octet-stream-ish bytes so TypeByExtension is used.
	dir := filepath.Join("media", "uploads", "u1")
	_ = os.MkdirAll(dir, 0o755)
	fn := "x.mp4"
	_ = os.WriteFile(filepath.Join(dir, fn), []byte{0x00, 0x01, 0x02, 0x03}, 0o644)

	out, err := loadUploadedMediaFromRelPaths([]string{"/media/uploads/u1/" + fn})
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 got %d", len(out))
	}
	if out[0].ContentType == "" {
		t.Fatalf("expected contentType set")
	}
}

func TestLoadUploadedMediaFromRelPaths_MissingFile(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	_, err := loadUploadedMediaFromRelPaths([]string{"/media/uploads/u1/does-not-exist.mp4"})
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestParsePublishPostRequest_JSONPath(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/x", bytes.NewBufferString(`{"caption":"c","providers":["tiktok"],"facebookPageIds":["pg1"],"dryRun":true}`))
	req.Header.Set("Content-Type", "application/json")
	parsed, media, err := parsePublishPostRequest(req)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.Caption != "c" || len(parsed.Providers) != 1 || parsed.Providers[0] != "tiktok" || !parsed.DryRun {
		t.Fatalf("unexpected parsed: %+v", parsed)
	}
	if len(media) != 0 {
		t.Fatalf("expected no media")
	}
}

func TestPublishSocialPostForUser_NotSupportedProvidersPath(t *testing.T) {
	// Choose providers that are stubbed as not_supported_yet to avoid DB dependencies.
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-posts/publish/user/u1", bytes.NewBufferString(`{"caption":"hi","providers":["tiktok","threads"]}`))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.PublishSocialPostForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if out["ok"] != false {
		t.Fatalf("expected ok=false got %#v", out["ok"])
	}
}

func TestEnqueuePublishJobForUser_ValidationPaths(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/social-posts/publish-async/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.EnqueuePublishJobForUser(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/social-posts/publish-async/user/u1", bytes.NewBufferString(`{"caption":""}`))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.EnqueuePublishJobForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestRunPublishJob_NoKnownProviders(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	mock.ExpectExec(`UPDATE public\.publish_jobs.*status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*last_publish_status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE public\.publish_jobs.*SET status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*SET last_publish_status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))

	h.runPublishJob("job1", "u1", "cap", publishPostRequest{Providers: []string{"unknown"}}, nil, "https://app.test")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
