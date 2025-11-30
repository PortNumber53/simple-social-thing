package handlers

import (
	"bytes"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestStoreSunoTrack_DownstreamNon2xx(t *testing.T) {
	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 500, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("no"))}, nil
	}}

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/suno/store", bytes.NewBufferString(`{"userId":"u1","audioUrl":"https://audio.test/a.mp3"}`))
	h.StoreSunoTrack(rr, req)
	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 got %d body=%q", rr.Code, rr.Body.String())
	}
}

func TestStoreSunoTrack_DBInsertError(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("mp3data"))}, nil
	}}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	mock.ExpectExec(`INSERT INTO public\."SunoTracks"`).
		WillReturnError(sql.ErrConnDone)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/suno/store", bytes.NewBufferString(`{"userId":"u1","prompt":"p","sunoTrackId":"sid","audioUrl":"https://audio.test/a.mp3"}`))
	h.StoreSunoTrack(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 got %d body=%q", rr.Code, rr.Body.String())
	}
	_ = mock.ExpectationsWereMet()
}

func TestSunoMusicCallback_InvalidJSON_MissingTaskId_NoTrack(t *testing.T) {
	// invalid json
	{
		h := New(nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/callback", bytes.NewBufferString("{"))
		h.SunoMusicCallback(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d", rr.Code)
		}
	}

	// missing taskId
	{
		h := New(nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/callback", bytes.NewBufferString(`{"data":{"status":"SUCCESS"}}`))
		h.SunoMusicCallback(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d", rr.Code)
		}
	}

	// no track found
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectQuery(`SELECT id FROM public\."SunoTracks" WHERE task_id = \$1`).
			WithArgs("task1").
			WillReturnError(sql.ErrNoRows)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/callback", bytes.NewBufferString(`{"data":{"taskId":"task1","status":"SUCCESS"}}`))
		h.SunoMusicCallback(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d", rr.Code)
		}
		_ = mock.ExpectationsWereMet()
	}
}

func TestUpdateSunoTrack_DownloadNon2xx_AndDBError(t *testing.T) {
	// download non-2xx
	{
		orig := http.DefaultTransport
		defer func() { http.DefaultTransport = orig }()
		http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 500, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("no"))}, nil
		}}

		db, _, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/tracks/t1", bytes.NewBufferString(`{"audioUrl":"https://audio.test/a.mp3","status":"completed"}`))
		req = mux.SetURLVars(req, map[string]string{"id": "t1"})
		h.UpdateSunoTrack(rr, req)
		if rr.Code != http.StatusBadGateway {
			t.Fatalf("expected 502 got %d", rr.Code)
		}
	}

	// db update error (no download path)
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectExec(`UPDATE public\."SunoTracks"`).
			WillReturnError(sql.ErrConnDone)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/tracks/t1", bytes.NewBufferString(`{"status":"pending"}`))
		req = mux.SetURLVars(req, map[string]string{"id": "t1"})
		h.UpdateSunoTrack(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 got %d", rr.Code)
		}
		_ = mock.ExpectationsWereMet()
	}
}
