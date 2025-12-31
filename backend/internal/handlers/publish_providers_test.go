package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type stubTransport struct {
	fn func(*http.Request) (*http.Response, error)
}

func (t stubTransport) RoundTrip(r *http.Request) (*http.Response, error) { return t.fn(r) }

func httpJSON(status int, body string, headers map[string]string) *http.Response {
	h := make(http.Header)
	h.Set("Content-Type", "application/json")
	for k, v := range headers {
		h.Set(k, v)
	}
	return &http.Response{
		StatusCode: status,
		Header:     h,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestHelpers_Truncate_PublicOrigin_RandHex(t *testing.T) {
	if got := truncate("hello", 2); got != "he…" {
		t.Fatalf("truncate: got %q", got)
	}
	if got := truncate("hi", 10); got != "hi" {
		t.Fatalf("truncate: got %q", got)
	}

	req, _ := http.NewRequest("GET", "http://example.com/x", nil)
	req.Host = "example.com"
	if got := publicOrigin(req); got != "http://example.com" {
		t.Fatalf("publicOrigin: got %q", got)
	}
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "app.test")
	if got := publicOrigin(req); got != "https://app.test" {
		t.Fatalf("publicOrigin forwarded: got %q", got)
	}

	hx := randHex(12)
	if len(hx) == 0 {
		t.Fatalf("randHex empty")
	}
}

func TestPublishInstagramWithImageURLs_Success_Carousel(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	// OAuth payload required by IG publish
	oauth := instagramOAuth{AccessToken: "tok", IGBusinessID: "ig123"}
	raw, _ := json.Marshal(oauth)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='instagram_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	// Expect a SocialLibraries upsert on success
	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WithArgs(sqlmock.AnyArg(), "u1", "caption", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Stub Graph API calls via DefaultTransport
	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()

	// Two child containers + parent container + publish.
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "graph.facebook.com" {
			return httpJSON(500, `{"error":"unexpected_host"}`, nil), nil
		}
		p := r.URL.Path
		// Create media container(s)
		if r.Method == "POST" && strings.Contains(p, "/media") && !strings.Contains(p, "media_publish") {
			// Return deterministic IDs based on content
			// First two calls -> c1, c2; third call (carousel parent) -> pc1
			if !strings.Contains(r.URL.RawQuery, "") {
				// ignore
			}
			// Use a timestamp-ish counter in closure
			// (Simpler: decide by presence of "children" in body)
			b, _ := io.ReadAll(r.Body)
			_ = r.Body.Close()
			if bytes.Contains(b, []byte("children=")) || bytes.Contains(b, []byte("media_type=CAROUSEL")) {
				return httpJSON(200, `{"id":"pc1"}`, nil), nil
			}
			// child container
			if bytes.Contains(b, []byte("image_url=")) {
				if bytes.Contains(b, []byte("a.png")) {
					return httpJSON(200, `{"id":"c1"}`, nil), nil
				}
				return httpJSON(200, `{"id":"c2"}`, nil), nil
			}
			return httpJSON(200, `{"id":"cX"}`, nil), nil
		}
		// Container status polling
		if r.Method == "GET" && (p == "/v18.0/c1" || p == "/v18.0/c2" || p == "/v18.0/pc1") {
			return httpJSON(200, `{"id":"x","status_code":"FINISHED"}`, nil), nil
		}
		// Publish media
		if r.Method == "POST" && strings.Contains(p, "media_publish") {
			return httpJSON(200, `{"id":"ig_media_1"}`, nil), nil
		}
		return httpJSON(404, `{"error":"not_found"}`, nil), nil
	}}

	posted, perr, _ := h.publishInstagramWithImageURLs(context.Background(), "u1", "caption", []string{"https://x/a.png", "https://x/b.png"}, false)
	if perr != nil {
		t.Fatalf("publish err: %v", perr)
	}
	if posted != 1 {
		t.Fatalf("expected posted=1 got %d", posted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestPublishTikTokWithVideoURL_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	oauth := tiktokOAuth{AccessToken: "tok", OpenID: "oid", Scope: "video.upload,video.publish"}
	raw, _ := json.Marshal(oauth)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='tiktok_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "open.tiktokapis.com" && strings.Contains(r.URL.Path, "/v2/post/publish/inbox/video/init/") {
			return httpJSON(200, `{"data":{"publish_id":"p1"}}`, nil), nil
		}
		return httpJSON(404, `{"error":"not_found"}`, nil), nil
	}}

	posted, perr, _ := h.publishTikTokWithVideoURL(context.Background(), "u1", "caption", "https://video.example/v.mp4", false)
	if perr != nil {
		t.Fatalf("publish err: %v", perr)
	}
	if posted != 1 {
		t.Fatalf("expected posted=1 got %d", posted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestPublishYouTubeWithVideoBytes_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	oauth := youtubeOAuth{AccessToken: "tok", Scope: "https://www.googleapis.com/auth/youtube.upload", ExpiresAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339)}
	raw, _ := json.Marshal(oauth)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='youtube_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "www.googleapis.com" && strings.Contains(r.URL.Path, "/upload/youtube/v3/videos") && r.Method == "POST" {
			return httpJSON(200, `{}`, map[string]string{"Location": "https://upload.youtube.com/resumable/1"}), nil
		}
		if r.URL.Host == "upload.youtube.com" && r.Method == "PUT" {
			return httpJSON(200, `{"id":"vid1"}`, nil), nil
		}
		return httpJSON(404, `{"error":"not_found"}`, nil), nil
	}}

	posted, perr, _ := h.publishYouTubeWithVideoBytes(context.Background(), "u1", "My caption", uploadedMedia{Filename: "v.mp4", ContentType: "video/mp4", Bytes: []byte("1234")}, false)
	if perr != nil {
		t.Fatalf("publish err: %v", perr)
	}
	if posted != 1 {
		t.Fatalf("expected posted=1 got %d", posted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestPublishInstagram_WritesMediaAndUsesPublicOrigin(t *testing.T) {
	// This covers saveUploadedMedia + publicOrigin + publishInstagram wrapper.
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

	// Mock IG oauth
	oauth := instagramOAuth{AccessToken: "tok", IGBusinessID: "ig123"}
	raw, _ := json.Marshal(oauth)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='instagram_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WithArgs(sqlmock.AnyArg(), "u1", "caption", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "graph.facebook.com" && strings.Contains(r.URL.Path, "/media_publish") && r.Method == "POST" {
			return httpJSON(200, `{"id":"ig_media_1"}`, nil), nil
		}
		if r.URL.Host == "graph.facebook.com" && strings.Contains(r.URL.Path, "/media") && r.Method == "POST" {
			return httpJSON(200, `{"id":"c1"}`, nil), nil
		}
		if r.URL.Host == "graph.facebook.com" && strings.Contains(r.URL.Path, "/v18.0/c1") && r.Method == "GET" {
			return httpJSON(200, `{"id":"c1","status_code":"FINISHED"}`, nil), nil
		}
		return httpJSON(404, `{"error":"not_found"}`, nil), nil
	}}

	req, _ := http.NewRequest("POST", "http://app.test/publish", nil)
	req.Host = "app.test"
	posted, perr, _ := h.publishInstagram(context.Background(), req, "u1", "caption", []uploadedMedia{{Filename: "a.jpg", ContentType: "image/jpeg", Bytes: []byte("img")}}, false)
	if perr != nil {
		t.Fatalf("publish err: %v", perr)
	}
	if posted != 1 {
		t.Fatalf("expected posted=1 got %d", posted)
	}
	// Ensure media file was saved under temp working dir.
	userHash := mediaUserHash("u1")
	base := filepath.Join(tmp, "media", userHash)
	shards, _ := os.ReadDir(base)
	found := false
	for _, s := range shards {
		if s == nil || !s.IsDir() {
			continue
		}
		files, _ := os.ReadDir(filepath.Join(base, s.Name()))
		for _, f := range files {
			if f != nil && !f.IsDir() {
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatalf("expected saved media under %s", base)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestExtractFacebookErrorMessage(t *testing.T) {
	body := []byte(`{"error":{"message":"nope"}}`)
	if got := extractFacebookErrorMessage(body, string(body)); got != "nope" {
		t.Fatalf("expected nope got %q", got)
	}
	if got := extractFacebookErrorMessage([]byte("not-json"), "fallback"); got != "fallback" {
		t.Fatalf("expected fallback got %q", got)
	}
}

func TestPublishPinterestWithImageURL_Success_Minimal(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	oauth := pinterestOAuth{AccessToken: "tok", Scope: "pins:write,boards:read", ExpiresAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339)}
	raw, _ := json.Marshal(oauth)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='pinterest_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		// Boards list (return one board)
		if strings.Contains(r.URL.Host, "api.pinterest.com") && strings.Contains(r.URL.Path, "/v5/boards") && r.Method == "GET" {
			return httpJSON(200, `{"items":[{"id":"b1"}]}`, nil), nil
		}
		// Create pin
		if strings.Contains(r.URL.Host, "api.pinterest.com") && strings.Contains(r.URL.Path, "/v5/pins") && r.Method == "POST" {
			return httpJSON(201, `{"id":"pin1"}`, nil), nil
		}
		return httpJSON(404, `{"error":"not_found"}`, nil), nil
	}}

	posted, perr, _ := h.publishPinterestWithImageURL(context.Background(), "u1", "cap", "https://img/x.png", false)
	if perr != nil {
		t.Fatalf("publish err: %v", perr)
	}
	if posted != 1 {
		t.Fatalf("expected posted=1 got %d", posted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestPublishFacebookPages_DryRunAndMediaPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	payload := fbOAuthPayload{
		Pages: []fbOAuthPageRow{{ID: "pg1", AccessToken: "ptok", Tasks: []string{"CREATE_CONTENT"}}},
	}
	raw, _ := json.Marshal(payload)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='facebook_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	// dryRun avoids any HTTP calls
	posted, perr, _ := h.publishFacebookPages(context.Background(), "u1", "cap", nil, []uploadedMedia{{Filename: "a.jpg", ContentType: "image/jpeg", Bytes: []byte("x")}}, true)
	if perr != nil {
		t.Fatalf("publish err: %v", perr)
	}
	if posted != 0 {
		t.Fatalf("expected posted=0 in dryRun got %d", posted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestPublishFacebookPages_WithImages_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	payload := fbOAuthPayload{
		Pages: []fbOAuthPageRow{{ID: "pg1", AccessToken: "ptok", Tasks: []string{"CREATE_CONTENT"}}},
	}
	raw, _ := json.Marshal(payload)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='facebook_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))
	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WithArgs(sqlmock.AnyArg(), "u1", "cap", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "graph.facebook.com" {
			return httpJSON(404, `{"error":"bad_host"}`, nil), nil
		}
		// Upload photo (published=false)
		if strings.Contains(r.URL.Path, "/photos") && r.Method == "POST" {
			return httpJSON(200, `{"id":"photo1"}`, nil), nil
		}
		// Create feed post with attached media
		if strings.Contains(r.URL.Path, "/feed") && r.Method == "POST" {
			return httpJSON(200, `{"id":"post1"}`, nil), nil
		}
		return httpJSON(404, `{"error":"not_found"}`, nil), nil
	}}

	posted, perr, _ := h.publishFacebookPages(context.Background(), "u1", "cap", []string{"pg1"}, []uploadedMedia{{Filename: "a.jpg", ContentType: "image/jpeg", Bytes: []byte("x")}}, false)
	if perr != nil {
		t.Fatalf("publish err: %v", perr)
	}
	if posted != 1 {
		t.Fatalf("expected posted=1 got %d", posted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

// NOTE: We intentionally avoid end-to-end tests for `runPublishJob` here because it couples together:
// - filesystem media persistence
// - multiple provider HTTP behaviors
// - multiple UserSettings rows
// - SocialLibraries writes
// This is already covered more reliably by focused unit tests for each provider/publisher.
