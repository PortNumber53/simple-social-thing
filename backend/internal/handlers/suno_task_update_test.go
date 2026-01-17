package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestCreateSunoTask_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	mock.ExpectExec(`INSERT INTO public\.suno_tracks`).
		WithArgs(sqlmock.AnyArg(), "u1", "p", "task1", "V4").
		WillReturnResult(sqlmock.NewResult(1, 1))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/suno/tasks", bytes.NewBufferString(`{"user_id":"u1","prompt":"p","taskId":"task1","model":"V4"}`))
	h.CreateSunoTask(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if out["ok"] != true {
		t.Fatalf("expected ok=true, got %v", out["ok"])
	}
	if id, _ := out["id"].(string); !strings.HasPrefix(id, "suno-") {
		t.Fatalf("expected id to start with suno-, got %v", out["id"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestUpdateSunoTrack_NoDownload(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	now := time.Now().UTC()
	mock.ExpectQuery(`UPDATE public\.suno_tracks`).
		WithArgs("", "sid", "", "", "pending", "track1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "prompt", "suno_track_id", "audio_url", "file_path", "status", "created_at", "updated_at"}).
			AddRow("track1", nil, nil, nil, "sid", nil, nil, "pending", now, now))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/suno/tracks/track1", bytes.NewBufferString(`{"sunoTrackId":"sid","status":"pending"}`))
	req = mux.SetURLVars(req, map[string]string{"id": "track1"})
	h.UpdateSunoTrack(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestUpdateSunoTrack_DownloadsAudioWhenCompleted(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "audio.test" {
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewReader([]byte("mp3data"))),
			}, nil
		}
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("not_found")), Header: make(http.Header)}, nil
	}}

	now := time.Now().UTC()
	mock.ExpectQuery(`UPDATE public\.suno_tracks`).
		WithArgs("", "suno1", "https://audio.test/a.mp3", sqlmock.AnyArg(), "completed", "track1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "title", "prompt", "suno_track_id", "audio_url", "file_path", "status", "created_at", "updated_at"}).
			AddRow("track1", nil, nil, nil, "suno1", "https://audio.test/a.mp3", "media/suno/track1.mp3", "completed", now, now))

	rr := httptest.NewRecorder()
	body := `{"sunoTrackId":"suno1","audioUrl":"https://audio.test/a.mp3","status":"completed"}`
	req := httptest.NewRequest(http.MethodPut, "/api/suno/tracks/track1", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"id": "track1"})
	h.UpdateSunoTrack(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	if _, err := os.Stat(filepath.Join("media", "suno", "track1.mp3")); err != nil {
		t.Fatalf("expected downloaded file: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
