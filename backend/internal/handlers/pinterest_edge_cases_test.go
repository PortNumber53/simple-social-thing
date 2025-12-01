package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestPublishPinterestWithImageURL_EdgeCases(t *testing.T) {
	// missing scope
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		raw, _ := json.Marshal(pinterestOAuth{AccessToken: "ptok", Scope: "pins:read"})
		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='pinterest_oauth'`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

		_, err2, _ := h.publishPinterestWithImageURL(context.Background(), "u1", "cap", "https://img/x.png", false)
		if err2 == nil || err2.Error() != "missing_scope" {
			t.Fatalf("expected missing_scope got %v", err2)
		}
		_ = mock.ExpectationsWereMet()
	}

	// token expired
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		raw, _ := json.Marshal(pinterestOAuth{AccessToken: "ptok", Scope: "pins:write,boards:read", ExpiresAt: time.Now().Add(-1 * time.Hour).Format(time.RFC3339)})
		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='pinterest_oauth'`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

		_, err2, _ := h.publishPinterestWithImageURL(context.Background(), "u1", "cap", "https://img/x.png", false)
		if err2 == nil || err2.Error() != "token_expired_reconnect" {
			t.Fatalf("expected token_expired_reconnect got %v", err2)
		}
		_ = mock.ExpectationsWereMet()
	}

	// dryRun success
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		raw, _ := json.Marshal(pinterestOAuth{AccessToken: "ptok", Scope: "pins:write,boards:read", ExpiresAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339)})
		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='pinterest_oauth'`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

		posted, err2, det := h.publishPinterestWithImageURL(context.Background(), "u1", "cap", "https://img/x.png", true)
		if err2 != nil || posted != 0 || det["dryRun"] != true {
			t.Fatalf("expected dryRun ok got posted=%d err=%v det=%v", posted, err2, det)
		}
		_ = mock.ExpectationsWereMet()
	}

	// not connected (no rows)
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='pinterest_oauth'`).
			WithArgs("u1").
			WillReturnError(sql.ErrNoRows)

		_, err2, _ := h.publishPinterestWithImageURL(context.Background(), "u1", "cap", "https://img/x.png", true)
		if err2 == nil || err2.Error() != "not_connected" {
			t.Fatalf("expected not_connected got %v", err2)
		}
		_ = mock.ExpectationsWereMet()
	}
}

func TestPublishPinterestWithImageURL_CreateBoardAndSandboxRetry(t *testing.T) {
	// Create-board path when boards list is empty.
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		raw, _ := json.Marshal(pinterestOAuth{AccessToken: "ptok", Scope: "pins:write,boards:read", ExpiresAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339)})
		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='pinterest_oauth'`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

		orig := http.DefaultTransport
		defer func() { http.DefaultTransport = orig }()
		http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "api.pinterest.com") && strings.Contains(r.URL.Path, "/v5/boards") && r.Method == "GET" {
				return httpJSON(200, `{"items":[]}`, nil), nil
			}
			if strings.Contains(r.URL.Host, "api.pinterest.com") && strings.Contains(r.URL.Path, "/v5/boards") && r.Method == "POST" {
				return httpJSON(201, `{"id":"b_new"}`, nil), nil
			}
			if strings.Contains(r.URL.Host, "api.pinterest.com") && strings.Contains(r.URL.Path, "/v5/pins") && r.Method == "POST" {
				return httpJSON(201, `{"id":"pin1"}`, nil), nil
			}
			return httpJSON(404, `{"error":"not_found"}`, nil), nil
		}}

		posted, err2, _ := h.publishPinterestWithImageURL(context.Background(), "u1", "cap", "https://img/x.png", false)
		if err2 != nil || posted != 1 {
			t.Fatalf("expected posted=1 err=nil got posted=%d err=%v", posted, err2)
		}
		_ = mock.ExpectationsWereMet()
	}

	// Trial sandbox retry path: first call on api.pinterest.com returns 403 trial error, then succeed on api-sandbox.
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		raw, _ := json.Marshal(pinterestOAuth{AccessToken: "ptok", Scope: "pins:write,boards:read"})
		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='pinterest_oauth'`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

		orig := http.DefaultTransport
		defer func() { http.DefaultTransport = orig }()
		http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			if r.URL.Host == "api.pinterest.com" && strings.Contains(r.URL.Path, "/v5/boards") && r.Method == "GET" {
				return httpJSON(403, `{"code":29,"message":"Trial access - use api-sandbox.pinterest.com"}`, nil), nil
			}
			if r.URL.Host == "api-sandbox.pinterest.com" && strings.Contains(r.URL.Path, "/v5/boards") && r.Method == "GET" {
				return httpJSON(200, `{"items":[{"id":"b1"}]}`, nil), nil
			}
			if r.URL.Host == "api-sandbox.pinterest.com" && strings.Contains(r.URL.Path, "/v5/pins") && r.Method == "POST" {
				return httpJSON(201, `{"id":"pin1"}`, nil), nil
			}
			return httpJSON(404, `{"error":"not_found"}`, nil), nil
		}}

		posted, err2, det := h.publishPinterestWithImageURL(context.Background(), "u1", "cap", "https://img/x.png", false)
		if err2 != nil || posted != 1 {
			t.Fatalf("expected posted=1 err=nil got posted=%d err=%v det=%v", posted, err2, det)
		}
		_ = mock.ExpectationsWereMet()
	}
}
