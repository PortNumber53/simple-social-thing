package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestCreateSocialConnection_BadJSON(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-connections", bytes.NewBufferString("{"))
	h.CreateSocialConnection(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestCreateTeam_BadJSON(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/teams", bytes.NewBufferString("{"))
	h.CreateTeam(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestListSunoTracksForUser_QueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	mock.ExpectQuery(`FROM public\."SunoTracks"\s+WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/suno/tracks/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListSunoTracksForUser(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 got %d", rr.Code)
	}
	_ = mock.ExpectationsWereMet()
}

func TestDeleteSocialLibrariesForUser_ValidationAndDBError(t *testing.T) {
	// method not allowed
	{
		h := New(nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/social-libraries/delete/user/u1", nil)
		req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
		h.DeleteSocialLibrariesForUser(rr, req)
		if rr.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected 405 got %d", rr.Code)
		}
	}

	// ids required
	{
		h := New(nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/social-libraries/delete/user/u1", bytes.NewBufferString(`{"ids":[]}`))
		req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
		h.DeleteSocialLibrariesForUser(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 got %d", rr.Code)
		}
	}

	// db exec error
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectQuery(`DELETE FROM public\."SocialLibraries"`).
			WithArgs("u1", sqlmock.AnyArg()).
			WillReturnError(sqlmock.ErrCancelled)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/social-libraries/delete/user/u1", bytes.NewBufferString(`{"ids":["a"]}`))
		req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
		h.DeleteSocialLibrariesForUser(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 got %d", rr.Code)
		}
		_ = mock.ExpectationsWereMet()
	}
}
