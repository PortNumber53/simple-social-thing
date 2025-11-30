package handlers

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestGetTeam_NotFoundAndDBError(t *testing.T) {
	t.Run("not found", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectQuery(`FROM public\."Teams" WHERE id = \$1`).
			WithArgs("t404").
			WillReturnError(sql.ErrNoRows)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/teams/t404", nil)
		req = mux.SetURLVars(req, map[string]string{"id": "t404"})
		h.GetTeam(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 got %d body=%q", rr.Code, rr.Body.String())
		}
		_ = mock.ExpectationsWereMet()
	})

	t.Run("db error", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectQuery(`FROM public\."Teams" WHERE id = \$1`).
			WithArgs("t1").
			WillReturnError(sql.ErrConnDone)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/teams/t1", nil)
		req = mux.SetURLVars(req, map[string]string{"id": "t1"})
		h.GetTeam(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 got %d body=%q", rr.Code, rr.Body.String())
		}
		_ = mock.ExpectationsWereMet()
	})
}

func TestCreateSunoTask_InvalidJSONAndDBError(t *testing.T) {
	t.Run("invalid json", func(t *testing.T) {
		h := New(nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/tasks", bytes.NewBufferString("{"))
		h.CreateSunoTask(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 got %d", rr.Code)
		}
	})

	t.Run("db error", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectExec(`INSERT INTO public\."SunoTracks"`).
			WillReturnError(sql.ErrConnDone)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/suno/tasks", bytes.NewBufferString(`{"userId":"u1","prompt":"p","taskId":"task1","model":"V4"}`))
		h.CreateSunoTask(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 got %d body=%q", rr.Code, rr.Body.String())
		}
		_ = mock.ExpectationsWereMet()
	})
}

func TestUpdateSunoTrack_InvalidJSON(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/suno/tracks/t1", bytes.NewBufferString("{"))
	req = mux.SetURLVars(req, map[string]string{"id": "t1"})
	h.UpdateSunoTrack(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}
