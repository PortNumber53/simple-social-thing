package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestHealth_OK(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)

	h.Health(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d", rr.Code)
	}
	var out map[string]bool
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("failed to decode json: %v body=%q", err, rr.Body.String())
	}
	if out["ok"] != true {
		t.Fatalf("expected ok=true got %#v", out)
	}
}

func TestCreateUser_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)
	now := time.Now().UTC()

	mock.ExpectQuery(`INSERT INTO public\."Users"`).
		WithArgs("u1", "e@example.com", "Alice", "img").
		WillReturnRows(
			sqlmock.NewRows([]string{"id", "email", "name", "imageUrl", "createdAt"}).
				AddRow("u1", "e@example.com", "Alice", "img", now),
		)

	body := `{"id":"u1","email":"e@example.com","name":"Alice","imageUrl":"img"}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/users", bytes.NewBufferString(body))

	h.CreateUser(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected application/json content-type got %q", ct)
	}

	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode json: %v body=%q", err, rr.Body.String())
	}
	if out["id"] != "u1" {
		t.Fatalf("expected id=u1 got %#v", out["id"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestCreateUser_BadJSON(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/users", bytes.NewBufferString("{"))

	h.CreateUser(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestGetUser_NotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)
	mock.ExpectQuery(`SELECT id, email, name, "imageUrl", "createdAt" FROM public\."Users"`).
		WithArgs("missing").
		WillReturnError(sql.ErrNoRows)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/users/missing", nil)
	req = mux.SetURLVars(req, map[string]string{"id": "missing"})

	h.GetUser(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d body=%q", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestGetUserSettings_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)
	rows := sqlmock.NewRows([]string{"key", "value"}).
		AddRow("foo", []byte(`"bar"`)).
		AddRow("obj", []byte(`{"a":1}`))

	mock.ExpectQuery(`SELECT key, value FROM public\."UserSettings" WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(rows)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/user-settings/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})

	h.GetUserSettings(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var out struct {
		OK   bool                       `json:"ok"`
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode json: %v body=%q", err, rr.Body.String())
	}
	if !out.OK {
		t.Fatalf("expected ok=true got %#v", out.OK)
	}
	if string(out.Data["foo"]) != `"bar"` {
		t.Fatalf("expected foo=\"bar\" got %s", string(out.Data["foo"]))
	}
	if string(out.Data["obj"]) != `{"a":1}` {
		t.Fatalf("expected obj={\"a\":1} got %s", string(out.Data["obj"]))
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestGetPublishJob_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)

	createdAt := time.Now().UTC()
	updatedAt := createdAt.Add(10 * time.Second)

	mock.ExpectQuery(`FROM public\."PublishJobs"\s+WHERE id = \$1`).
		WithArgs("pub_123").
		WillReturnRows(
			sqlmock.NewRows([]string{
				"user_id", "status", "providers", "caption", "request_json", "result_json",
				"error", "created_at", "started_at", "finished_at", "updated_at",
			}).
				AddRow(
					"u1",
					"completed",
					"{facebook,instagram}",
					"hello",
					[]byte(`{"caption":"hello"}`),
					[]byte(`{"results":{"facebook":{"ok":true}}}`),
					"",
					createdAt,
					sql.NullTime{Valid: true, Time: createdAt.Add(1 * time.Second)},
					sql.NullTime{Valid: true, Time: createdAt.Add(2 * time.Second)},
					updatedAt,
				),
		)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/social-posts/publish-jobs/pub_123", nil)
	req = mux.SetURLVars(req, map[string]string{"jobId": "pub_123"})

	h.GetPublishJob(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode json: %v body=%q", err, rr.Body.String())
	}
	if out["jobId"] != "pub_123" {
		t.Fatalf("expected jobId=pub_123 got %#v", out["jobId"])
	}
	if out["status"] != "completed" {
		t.Fatalf("expected status=completed got %#v", out["status"])
	}
	if _, ok := out["result"]; !ok {
		t.Fatalf("expected result field present got %#v", out)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestGetPublishJob_NotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)
	mock.ExpectQuery(`FROM public\."PublishJobs"\s+WHERE id = \$1`).
		WithArgs("missing").
		WillReturnError(sql.ErrNoRows)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/social-posts/publish-jobs/missing", nil)
	req = mux.SetURLVars(req, map[string]string{"jobId": "missing"})

	h.GetPublishJob(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d body=%q", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
