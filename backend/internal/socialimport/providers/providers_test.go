package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"golang.org/x/time/rate"
)

type stubTransport struct {
	fn func(*http.Request) (*http.Response, error)
}

func (s stubTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return s.fn(r)
}

func httpJSON(status int, body string, headers map[string]string) *http.Response {
	h := make(http.Header)
	if headers != nil {
		for k, v := range headers {
			h.Set(k, v)
		}
	}
	if h.Get("Content-Type") == "" {
		h.Set("Content-Type", "application/json")
	}
	return &http.Response{
		StatusCode: status,
		Header:     h,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestHelpers(t *testing.T) {
	if truncate("abc", 2) != "ab" {
		t.Fatalf("truncate failed")
	}
	if normalizeTitle("   ") != "" {
		t.Fatalf("normalizeTitle should trim to empty")
	}
	long := strings.Repeat("a", 300)
	if len(normalizeTitle(long)) != 160 {
		t.Fatalf("normalizeTitle should cap to 160")
	}

	if toInt64(1.2) == nil || *toInt64(1.2) != 1 {
		t.Fatalf("toInt64 float64 failed")
	}
	if toInt64("nope") != nil {
		t.Fatalf("toInt64 should return nil for invalid string")
	}
	if toInt64("12") == nil || *toInt64("12") != 12 {
		t.Fatalf("toInt64 string failed")
	}
}

func TestStubXProvider(t *testing.T) {
	p := XProvider{}
	if p.Name() != "x" {
		t.Fatalf("expected x")
	}
	f, u, err := p.SyncUser(context.Background(), nil, "u1", nil, nil, log.Default())
	if err != nil || f != 0 || u != 0 {
		t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
	}
}

func TestInstagramProvider_NilDB(t *testing.T) {
	p := InstagramProvider{}
	if p.Name() != "instagram" {
		t.Fatalf("expected instagram")
	}
	lim := rate.NewLimiter(rate.Inf, 1)
	_, _, err := p.SyncUser(context.Background(), nil, "u1", nil, lim, log.Default())
	if err == nil {
		t.Fatalf("expected error for nil db")
	}
}

func TestProviderNames(t *testing.T) {
	if (FacebookProvider{}).Name() != "facebook" {
		t.Fatalf("facebook name")
	}
	if (TikTokProvider{}).Name() != "tiktok" {
		t.Fatalf("tiktok name")
	}
	if (YouTubeProvider{}).Name() != "youtube" {
		t.Fatalf("youtube name")
	}
	if (PinterestProvider{}).Name() != "pinterest" {
		t.Fatalf("pinterest name")
	}
	if (ThreadsProvider{}).Name() != "threads" {
		t.Fatalf("threads name")
	}
}

func TestMoreHelperBranches(t *testing.T) {
	// toInt64 additional branches
	if toInt64(int64(7)) == nil || *toInt64(int64(7)) != 7 {
		t.Fatalf("toInt64 int64")
	}
	if toInt64(int(8)) == nil || *toInt64(int(8)) != 8 {
		t.Fatalf("toInt64 int")
	}
	if toInt64("") != nil {
		t.Fatalf("toInt64 empty string should be nil")
	}
	if toInt64(struct{}{}) != nil {
		t.Fatalf("toInt64 default should be nil")
	}

	// joinComma branches (youtube_provider.go)
	if joinComma(nil) != "" || joinComma([]string{}) != "" {
		t.Fatalf("joinComma empty")
	}
	if joinComma([]string{"a"}) != "a" {
		t.Fatalf("joinComma single")
	}
	if joinComma([]string{"a", "b", "c"}) != "a,b,c" {
		t.Fatalf("joinComma multi")
	}

	// sanitizeText removes NULs and keeps valid UTF-8
	if got := sanitizeText("a\x00b"); got != "ab" {
		t.Fatalf("sanitizeText nul removal: %q", got)
	}
}

func TestFacebookProvider_SyncUser_SkipsAndSuccess(t *testing.T) {
	// db nil
	{
		_, _, err := (FacebookProvider{}).SyncUser(context.Background(), nil, "u1", nil, nil, nil)
		if err == nil {
			t.Fatalf("expected db is nil error")
		}
	}

	// no oauth row => no-op
	{
		db, mock, _ := sqlmock.New()
		defer func() { _ = db.Close() }()
		mock.ExpectQuery(`SELECT value FROM public\.user_settings.*facebook_oauth`).
			WithArgs("u1").
			WillReturnError(sql.ErrNoRows)
		f, u, err := (FacebookProvider{}).SyncUser(context.Background(), db, "u1", nil, nil, log.Default())
		if err != nil || f != 0 || u != 0 {
			t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
		}
		_ = mock.ExpectationsWereMet()
	}

	// invalid oauth json => skip
	{
		db, mock, _ := sqlmock.New()
		defer func() { _ = db.Close() }()
		mock.ExpectQuery(`SELECT value FROM public\.user_settings.*facebook_oauth`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte("{")))
		f, u, err := (FacebookProvider{}).SyncUser(context.Background(), db, "u1", nil, nil, log.Default())
		if err != nil || f != 0 || u != 0 {
			t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
		}
		_ = mock.ExpectationsWereMet()
	}

	// success path: one page, one post
	{
		db, mock, _ := sqlmock.New()
		defer func() { _ = db.Close() }()

		tok := facebookOAuth{Pages: []facebookPage{{ID: "pg1", Name: ptr("Page"), AccessToken: "ptok"}}}
		raw, _ := json.Marshal(tok)
		mock.ExpectQuery(`SELECT value FROM public\.user_settings.*facebook_oauth`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

		mock.ExpectExec(`INSERT INTO public\.social_libraries`).
			WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))

		client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			if r.URL.Host != "graph.facebook.com" {
				return httpJSON(404, `{"error":"bad_host"}`, nil), nil
			}
			return httpJSON(200, `{"data":[{"id":"p1","message":"hello","created_time":"2025-01-01T00:00:00Z","permalink_url":"https://fb/p1","attachments":{"data":[{"type":"photo","url":"https://m","media":{"image":{"src":"https://t"}}}]}}]}`, nil), nil
		}}}

		f, u, err := (FacebookProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
		if err != nil || f != 1 || u != 1 {
			t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
		}
		_ = mock.ExpectationsWereMet()
	}
}

func TestTikTokProvider_SkipsAndSuccess(t *testing.T) {
	// missing scope => skip
	{
		db, mock, _ := sqlmock.New()
		defer func() { _ = db.Close() }()
		raw, _ := json.Marshal(tiktokOAuth{AccessToken: "t", OpenID: "o", Scope: "user.info.basic"})
		mock.ExpectQuery(`SELECT value FROM public\.user_settings.*tiktok_oauth`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))
		f, u, err := (TikTokProvider{}).SyncUser(context.Background(), db, "u1", nil, nil, log.Default())
		if err != nil || f != 0 || u != 0 {
			t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
		}
		_ = mock.ExpectationsWereMet()
	}

	// success path
	{
		db, mock, _ := sqlmock.New()
		defer func() { _ = db.Close() }()
		raw, _ := json.Marshal(tiktokOAuth{AccessToken: "t", OpenID: "o", Scope: "video.list"})
		mock.ExpectQuery(`SELECT value FROM public\.user_settings.*tiktok_oauth`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))
		mock.ExpectExec(`INSERT INTO public\.social_libraries`).
			WillReturnResult(sqlmock.NewResult(1, 1))

		client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			if r.URL.Host != "open.tiktokapis.com" {
				return httpJSON(404, `{"error":"bad_host"}`, nil), nil
			}
			return httpJSON(200, `{"data":{"videos":[{"id":"v1","title":"t","create_time":1735689600,"cover_image_url":"https://c","share_url":"https://s","view_count":"10","like_count":2}]}}`, nil), nil
		}}}

		f, u, err := (TikTokProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
		if err != nil || f != 1 || u != 1 {
			t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
		}
		_ = mock.ExpectationsWereMet()
	}

	// non-2xx error from API
	{
		db, mock, _ := sqlmock.New()
		defer func() { _ = db.Close() }()
		raw, _ := json.Marshal(tiktokOAuth{AccessToken: "t", OpenID: "o", Scope: "video.list"})
		mock.ExpectQuery(`SELECT value FROM public\.user_settings.*tiktok_oauth`).
			WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))
		client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
			return httpJSON(500, `{"error":"no"}`, nil), nil
		}}}
		_, _, err := (TikTokProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
		if err == nil {
			t.Fatalf("expected error")
		}
		_ = mock.ExpectationsWereMet()
	}
}

func TestYouTubeProvider_Success(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer func() { _ = db.Close() }()

	raw, _ := json.Marshal(youtubeOAuth{AccessToken: "yt"})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*youtube_oauth`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		switch {
		case r.URL.Host == "www.googleapis.com" && strings.Contains(r.URL.Path, "/youtube/v3/channels"):
			return httpJSON(200, `{"items":[{"id":"ch1","snippet":{"title":"Chan"},"contentDetails":{"relatedPlaylists":{"uploads":"pl1"}}}]}`, nil), nil
		case r.URL.Host == "www.googleapis.com" && strings.Contains(r.URL.Path, "/youtube/v3/playlistItems"):
			return httpJSON(200, `{"items":[{"contentDetails":{"videoId":"vid1"}}]}`, nil), nil
		case r.URL.Host == "www.googleapis.com" && strings.Contains(r.URL.Path, "/youtube/v3/videos"):
			return httpJSON(200, `{"items":[{"id":"vid1","snippet":{"title":"V","publishedAt":"2025-01-01T00:00:00Z","thumbnails":{"high":{"url":"https://t"}}},"statistics":{"viewCount":"1","likeCount":"2"}}]}`, nil), nil
		default:
			return httpJSON(404, `{"error":"not_found"}`, nil), nil
		}
	}}}

	f, u, err := (YouTubeProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
	if err != nil || f != 1 || u != 1 {
		t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
	}
	_ = mock.ExpectationsWereMet()
}

func TestYouTubeProvider_Non2xxChannels(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer func() { _ = db.Close() }()
	raw, _ := json.Marshal(youtubeOAuth{AccessToken: "yt"})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*youtube_oauth`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		return httpJSON(401, `{"error":"no"}`, nil), nil
	}}}
	_, _, err := (YouTubeProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
	if err == nil {
		t.Fatalf("expected error")
	}
	_ = mock.ExpectationsWereMet()
}

func TestPinterestProvider_Success(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer func() { _ = db.Close() }()

	raw, _ := json.Marshal(pinterestOAuth{AccessToken: "pt"})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*pinterest_oauth`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.pinterest.com" {
			return httpJSON(404, `{"error":"bad_host"}`, nil), nil
		}
		return httpJSON(200, `{"items":[{"id":"pin1","title":"t","description":"d","link":"https://p","created_at":"2025-01-01T00:00:00Z","media":{"images":{"400x300":{"url":"https://img"}}}}]}`, nil), nil
	}}}

	f, u, err := (PinterestProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
	if err != nil || f != 1 || u != 1 {
		t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
	}
	_ = mock.ExpectationsWereMet()
}

func TestPinterestProvider_Non2xx(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer func() { _ = db.Close() }()
	raw, _ := json.Marshal(pinterestOAuth{AccessToken: "pt"})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*pinterest_oauth`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		return httpJSON(500, `{"error":"no"}`, nil), nil
	}}}
	_, _, err := (PinterestProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
	if err == nil {
		t.Fatalf("expected error")
	}
	_ = mock.ExpectationsWereMet()
}

func TestThreadsProvider_Success(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer func() { _ = db.Close() }()

	raw, _ := json.Marshal(threadsOAuth{AccessToken: "tt", ThreadsUserID: "tu1"})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*threads_oauth`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	client := &http.Client{Transport: stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "graph.facebook.com" {
			return httpJSON(404, `{"error":"bad_host"}`, nil), nil
		}
		return httpJSON(200, `{"data":[{"id":"th1","text":"hi","permalink":"https://th","timestamp":"2025-01-01T00:00:00Z","media_url":"https://m","thumbnail_url":"https://t","like_count":5}]}`, nil), nil
	}}}

	f, u, err := (ThreadsProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.Default())
	if err != nil || f != 1 || u != 1 {
		t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
	}
	_ = mock.ExpectationsWereMet()
}

func ptr(s string) *string { return &s }

func TestInstagramProvider_SyncUser_PassesThroughNoRows(t *testing.T) {
	// This covers the "limiter waits then instagram.SyncUser returns nil" path.
	db, mock, _ := sqlmock.New()
	defer func() { _ = db.Close() }()
	// Underlying instagram.SyncUser queries instagram_oauth; return no rows.
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*instagram_oauth`).
		WithArgs("u1").
		WillReturnError(sql.ErrNoRows)

	p := InstagramProvider{}
	lim := rate.NewLimiter(rate.Inf, 1)
	f, u, err := p.SyncUser(context.Background(), db, "u1", nil, lim, log.Default())
	if err != nil || f != 0 || u != 0 {
		t.Fatalf("unexpected: f=%d u=%d err=%v", f, u, err)
	}
	_ = mock.ExpectationsWereMet()
}
