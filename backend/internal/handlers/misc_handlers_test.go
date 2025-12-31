package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestCreateAndListSocialConnections(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	now := time.Now().UTC()
	// CreateSocialConnection
	mock.ExpectQuery(`INSERT INTO public\.social_connections`).
		WithArgs("c1", "u1", "instagram", "pid1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "userId", "provider", "providerId", "email", "name", "createdAt"}).
			AddRow("c1", "u1", "instagram", "pid1", sql.NullString{}, sql.NullString{}, now))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-connections", bytes.NewBufferString(`{"id":"c1","userId":"u1","provider":"instagram","providerId":"pid1"}`))
	h.CreateSocialConnection(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	// GetUserSocialConnections
	mock.ExpectQuery(`FROM public\.social_connections WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "userId", "provider", "providerId", "email", "name", "createdAt"}).
			AddRow("c1", "u1", "instagram", "pid1", sql.NullString{}, sql.NullString{}, now))

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/social-connections/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.GetUserSocialConnections(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestTeams_CreateGetList(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	now := time.Now().UTC()
	owner := "u1"
	tier := "free"

	mock.ExpectQuery(`INSERT INTO public\.teams`).
		WithArgs("t1", &owner, &tier).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_id", "current_tier", "posts_created_today", "usage_reset_date", "ig_llat", "stripe_customer_id", "stripe_subscription_id", "createdAt"}).
			AddRow("t1", owner, tier, 0, nil, nil, nil, nil, now))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/teams", bytes.NewBufferString(`{"id":"t1","ownerId":"u1","currentTier":"free"}`))
	h.CreateTeam(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	mock.ExpectQuery(`FROM public\.teams WHERE id = \$1`).
		WithArgs("t1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_id", "current_tier", "posts_created_today", "usage_reset_date", "ig_llat", "stripe_customer_id", "stripe_subscription_id", "createdAt"}).
			AddRow("t1", owner, tier, 0, nil, nil, nil, nil, now))

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/teams/t1", nil)
	req = mux.SetURLVars(req, map[string]string{"id": "t1"})
	h.GetTeam(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	mock.ExpectQuery(`FROM public\.teams t`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_id", "current_tier", "posts_created_today", "usage_reset_date", "ig_llat", "stripe_customer_id", "stripe_subscription_id", "createdAt"}).
			AddRow("t1", owner, tier, 0, nil, nil, nil, nil, now))

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/teams/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.GetUserTeams(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestUserSettings_GetAndUpsert(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	// GetUserSetting not found
	mock.ExpectQuery(`SELECT value FROM public\.user_settings WHERE user_id = \$1 AND key = \$2`).
		WithArgs("u1", "k1").
		WillReturnError(sql.ErrNoRows)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/user-settings/u1/k1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1", "key": "k1"})
	h.GetUserSetting(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d", rr.Code)
	}

	// Upsert invalid json
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/user-settings/u1/k1", bytes.NewBufferString("{"))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1", "key": "k1"})
	h.UpsertUserSetting(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	// Upsert success
	mock.ExpectExec(`INSERT INTO public\.user_settings`).
		WithArgs("u1", "k1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/user-settings/u1/k1", bytes.NewBufferString(`{"value":{"a":1}}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1", "key": "k1"})
	h.UpsertUserSetting(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	// GetUserSetting success
	mock.ExpectQuery(`SELECT value FROM public\.user_settings WHERE user_id = \$1 AND key = \$2`).
		WithArgs("u1", "k1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"a":1}`)))
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/user-settings/u1/k1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1", "key": "k1"})
	h.GetUserSetting(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	// GetUserSettings bundle
	mock.ExpectQuery(`SELECT key, value FROM public\.user_settings WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"key", "value"}).
			AddRow("k1", []byte(`{"a":1}`)).
			AddRow("k2", []byte(`"x"`)))
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/user-settings/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.GetUserSettings(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var bundle struct {
		OK   bool                       `json:"ok"`
		Data map[string]json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &bundle)
	if !bundle.OK || string(bundle.Data["k2"]) != `"x"` {
		t.Fatalf("unexpected bundle: %+v", bundle)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
