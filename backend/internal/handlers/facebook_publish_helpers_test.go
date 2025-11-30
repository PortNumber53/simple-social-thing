package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestFBPublishWithImages_MultiImage_SuccessAndError(t *testing.T) {
	// Multi-image success
	{
		call := 0
		orig := http.DefaultTransport
		defer func() { http.DefaultTransport = orig }()
		http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			if r.URL.Host != "graph.facebook.com" {
				return httpJSON(404, `{"error":"bad_host"}`, nil), nil
			}
			if strings.Contains(r.URL.Path, "/photos") && r.Method == "POST" {
				call++
				return httpJSON(200, `{"id":"ph`+string(rune('0'+call))+`"}`, nil), nil
			}
			if strings.Contains(r.URL.Path, "/feed") && r.Method == "POST" {
				return httpJSON(200, `{"id":"post1"}`, nil), nil
			}
			return httpJSON(404, `{"error":"not_found"}`, nil), nil
		}}

		client := &http.Client{Transport: http.DefaultTransport}
		postID, status, _, _, err := func() (string, int, string, string, error) {
			id, st, body, msg, e := fbPublishWithImages(
				context.Background(),
				client,
				"pg1",
				"ptok",
				"cap",
				[]uploadedMedia{
					{Filename: "a.jpg", ContentType: "image/jpeg", Bytes: []byte{0x01}},
					{Filename: "b.jpg", ContentType: "image/jpeg", Bytes: []byte{0x02}},
				},
			)
			return id, st, body, msg, e
		}()
		if err != nil || status != 200 || postID != "post1" {
			t.Fatalf("expected success postId=post1 status=200 err=nil got postId=%q status=%d err=%v", postID, status, err)
		}
	}

	// Multi-image error on feed post (non-2xx)
	{
		call := 0
		orig := http.DefaultTransport
		defer func() { http.DefaultTransport = orig }()
		http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			if r.URL.Host != "graph.facebook.com" {
				return httpJSON(404, `{"error":"bad_host"}`, nil), nil
			}
			if strings.Contains(r.URL.Path, "/photos") && r.Method == "POST" {
				call++
				return httpJSON(200, `{"id":"ph`+string(rune('0'+call))+`"}`, nil), nil
			}
			if strings.Contains(r.URL.Path, "/feed") && r.Method == "POST" {
				return httpJSON(400, `{"error":{"message":"nope"}}`, nil), nil
			}
			return httpJSON(404, `{"error":"not_found"}`, nil), nil
		}}

		client := &http.Client{Transport: http.DefaultTransport}
		_, _, _, errMsg, err := fbPublishWithImages(
			context.Background(),
			client,
			"pg1",
			"ptok",
			"cap",
			[]uploadedMedia{
				{Filename: "a.jpg", ContentType: "image/jpeg", Bytes: []byte{0x01}},
				{Filename: "b.jpg", ContentType: "image/jpeg", Bytes: []byte{0x02}},
			},
		)
		if err == nil || errMsg != "nope" {
			t.Fatalf("expected error with errMsg=nope got err=%v errMsg=%q", err, errMsg)
		}
	}
}

func TestPublishFacebookPages_CaptionOnly_AndInsufficientTasks(t *testing.T) {
	// Caption-only success inserts into SocialLibraries and makes a /feed call.
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		payload := fbOAuthPayload{Pages: []fbOAuthPageRow{{ID: "pg1", AccessToken: "ptok", Tasks: []string{"CREATE_CONTENT"}}}}
		raw, _ := json.Marshal(payload)
		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='facebook_oauth'`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))
		mock.ExpectExec(`INSERT INTO public\."SocialLibraries"`).
			WithArgs(sqlmock.AnyArg(), "u1", "cap", sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))

		orig := http.DefaultTransport
		defer func() { http.DefaultTransport = orig }()
		http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			if r.URL.Host == "graph.facebook.com" && strings.Contains(r.URL.Path, "/feed") && r.Method == "POST" {
				return httpJSON(200, `{"id":"post1"}`, nil), nil
			}
			return httpJSON(404, `{"error":"not_found"}`, nil), nil
		}}

		posted, perr, _ := h.publishFacebookPages(context.Background(), "u1", "cap", []string{"pg1"}, nil, false)
		if perr != nil || posted != 1 {
			t.Fatalf("expected posted=1 err=nil got posted=%d err=%v", posted, perr)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("sql expectations: %v", err)
		}
	}

	// Insufficient page role: should skip and return no_posts_created.
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		payload := fbOAuthPayload{Pages: []fbOAuthPageRow{{ID: "pg1", AccessToken: "ptok", Tasks: []string{"READ"}}}}
		raw, _ := json.Marshal(payload)
		mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='facebook_oauth'`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

		posted, perr, _ := h.publishFacebookPages(context.Background(), "u1", "cap", []string{"pg1"}, nil, false)
		if perr == nil || perr.Error() != "no_posts_created" || posted != 0 {
			t.Fatalf("expected no_posts_created posted=0 got posted=%d err=%v", posted, perr)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("sql expectations: %v", err)
		}
	}
}
