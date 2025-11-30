package handlers

import (
	"bytes"
	"database/sql"
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

func TestUpdateUser_SuccessAndNotFound(t *testing.T) {
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)
		now := time.Now().UTC()

		mock.ExpectQuery(`UPDATE public\."Users"`).
			WithArgs("u1", "e@example.com", "Alice", (*string)(nil)).
			WillReturnRows(sqlmock.NewRows([]string{"id", "email", "name", "imageUrl", "createdAt"}).
				AddRow("u1", "e@example.com", "Alice", nil, now))

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/users/u1", bytes.NewBufferString(`{"email":"e@example.com","name":"Alice"}`))
		req = mux.SetURLVars(req, map[string]string{"id": "u1"})
		h.UpdateUser(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("sql expectations: %v", err)
		}
	}

	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)
		mock.ExpectQuery(`UPDATE public\."Users"`).
			WillReturnError(sql.ErrNoRows)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/users/u1", bytes.NewBufferString(`{"email":"e@example.com","name":"Alice"}`))
		req = mux.SetURLVars(req, map[string]string{"id": "u1"})
		h.UpdateUser(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 got %d", rr.Code)
		}
		_ = mock.ExpectationsWereMet()
	}
}

func TestListSunoTracksForUser_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	now := time.Now().UTC()
	rows := sqlmock.NewRows([]string{"id", "user_id", "prompt", "task_id", "model", "suno_track_id", "audio_url", "file_path", "status", "created_at", "updated_at"}).
		AddRow("st1", "u1", "p", "t1", "V4", "sid", "https://a", "/x", "completed", now, now)

	mock.ExpectQuery(`FROM public\."SunoTracks"\s+WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(rows)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/suno/tracks/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListSunoTracksForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestStoreSunoTrack_MissingAudioURLAndSuccess(t *testing.T) {
	// Missing audioUrl
	{
		db, _, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/store", bytes.NewBufferString(`{"userId":"u1"}`))
		h.StoreSunoTrack(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 got %d", rr.Code)
		}
	}

	// Success path (download + save + DB insert)
	{
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

		mock.ExpectExec(`INSERT INTO public\."SunoTracks"`).
			WithArgs(sqlmock.AnyArg(), "u1", "p", "sid", "https://audio.test/a.mp3", sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))

		rr := httptest.NewRecorder()
		body := `{"userId":"u1","prompt":"p","sunoTrackId":"sid","audioUrl":"https://audio.test/a.mp3"}`
		req := httptest.NewRequest(http.MethodPost, "/api/suno/store", bytes.NewBufferString(body))
		h.StoreSunoTrack(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
		}
		var out sunoStoreResponse
		_ = json.Unmarshal(rr.Body.Bytes(), &out)
		if !out.OK || out.FilePath == "" {
			t.Fatalf("unexpected response: %+v", out)
		}
		if _, err := os.Stat(out.FilePath); err != nil {
			t.Fatalf("expected file saved at %q: %v", out.FilePath, err)
		}

		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("sql expectations: %v", err)
		}
	}
}

func TestSunoMusicCallback_SuccessPath(t *testing.T) {
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

	mock.ExpectQuery(`SELECT id FROM public\."SunoTracks" WHERE task_id = \$1`).
		WithArgs("task1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("track1"))

	mock.ExpectExec(`UPDATE public\."SunoTracks"`).
		WithArgs("suno1", "https://audio.test/a.mp3", sqlmock.AnyArg(), "completed", "track1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	payload := `{
		"data": {
			"taskId": "task1",
			"status": "SUCCESS",
			"response": { "sunoData": [ { "audioUrl": "https://audio.test/a.mp3", "id": "suno1" } ] }
		}
	}`
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/suno/callback", bytes.NewBufferString(payload))
	h.SunoMusicCallback(rr, req)
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

func TestCreateAndUpdateSunoTrack(t *testing.T) {
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

	// CreateSunoTask validation
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/suno/tasks", bytes.NewBufferString(`{"userId":"u1"}`))
	h.CreateSunoTask(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	// CreateSunoTask success
	mock.ExpectExec(`INSERT INTO public\."SunoTracks"`).
		WithArgs(sqlmock.AnyArg(), "u1", "p", "task1", "V4").
		WillReturnResult(sqlmock.NewResult(1, 1))
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/suno/tasks", bytes.NewBufferString(`{"userId":"u1","prompt":"p","taskId":"task1","model":"V4"}`))
	h.CreateSunoTask(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	// UpdateSunoTrack success: downloads audio and updates row
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

	mock.ExpectExec(`UPDATE public\."SunoTracks"`).
		WithArgs("sid", "https://audio.test/a.mp3", sqlmock.AnyArg(), "completed", "track1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/suno/tracks/track1", bytes.NewBufferString(`{"sunoTrackId":"sid","audioUrl":"https://audio.test/a.mp3","status":"completed"}`))
	req = mux.SetURLVars(req, map[string]string{"id": "track1"})
	h.UpdateSunoTrack(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(filepath.Join("media", "suno", "track1.mp3")); err != nil {
		t.Fatalf("expected file saved: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
