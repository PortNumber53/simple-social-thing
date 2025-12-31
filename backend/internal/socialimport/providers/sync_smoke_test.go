package providers

import (
	"context"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"golang.org/x/time/rate"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPinterestProvider_SyncUser_EmptyItems(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='pinterest_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"items":[]}`)),
		}, nil
	})}

	fetched, upserted, err := (PinterestProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestPinterestProvider_SyncUser_OneItem_Upserts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='pinterest_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"items":[{"id":"p1","title":" t ","link":"https://example","created_at":"2024-01-02T03:04:05Z","media":{"images":{"400x300":{"url":"thumb"}}}}]}`)),
		}, nil
	})}

	execRe := `INSERT INTO public\.social_libraries`
	mock.ExpectExec(execRe).
		WithArgs("pinterest:u1:p1", "u1", "t", "https://example", "https://example", "thumb", sqlmock.AnyArg(), sqlmock.AnyArg(), "p1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	fetched, upserted, err := (PinterestProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 1 || upserted != 1 {
		t.Fatalf("expected 1/1, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestPinterestProvider_SyncUser_Non2xx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='pinterest_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 500,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"error":"nope"}`)),
		}, nil
	})}

	_, _, err = (PinterestProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err == nil {
		t.Fatalf("expected error")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestPinterestProvider_SyncUser_FallbackThumb_TitleFallback_AndSkipBlankID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='pinterest_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body: io.NopCloser(strings.NewReader(`{"items":[
				{"id":"","title":"x"},
				{"id":"p2","title":"","description":" desc ","link":"","created_at":"bad","media":{"images":{"orig":{"url":"thumb2"}}}}
			]}`)),
		}, nil
	})}

	execRe := `INSERT INTO public\.social_libraries`
	mock.ExpectExec(execRe).
		WithArgs("pinterest:u1:p2", "u1", "desc", "", "", "thumb2", sqlmock.AnyArg(), sqlmock.AnyArg(), "p2").
		WillReturnResult(sqlmock.NewResult(1, 1))

	fetched, upserted, err := (PinterestProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 2 || upserted != 1 {
		t.Fatalf("expected fetched=2 upserted=1, got %d/%d", fetched, upserted)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestThreadsProvider_SyncUser_EmptyData(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='threads_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t","threadsUserId":"th"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":[]}`)),
		}, nil
	})}

	fetched, upserted, err := (ThreadsProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestThreadsProvider_SyncUser_OneItem_Upserts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='threads_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t","threadsUserId":"th"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":[{"id":"t1","text":" hello ","permalink":"pl","timestamp":"2024-01-02T03:04:05Z","media_url":"mu","thumbnail_url":"tu","like_count":2}]}`)),
		}, nil
	})}

	execRe := `INSERT INTO public\.social_libraries`
	mock.ExpectExec(execRe).
		WithArgs("threads:u1:t1", "u1", "hello", "pl", "mu", "tu", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "t1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	fetched, upserted, err := (ThreadsProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 1 || upserted != 1 {
		t.Fatalf("expected 1/1, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestThreadsProvider_SyncUser_Non2xx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='threads_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t","threadsUserId":"th"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 500,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"error":"nope"}`)),
		}, nil
	})}

	_, _, err = (ThreadsProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err == nil {
		t.Fatalf("expected error")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestTikTokProvider_SyncUser_EmptyVideos(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='tiktok_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t","openId":"o","scope":"video.list"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":{"videos":[]}}`)),
		}, nil
	})}

	fetched, upserted, err := (TikTokProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestTikTokProvider_SyncUser_OneVideo_Upserts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='tiktok_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t","openId":"o","scope":"video.list"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":{"videos":[{"id":"v1","title":"ti","share_url":"su","cover_image_url":"cu","create_time":1700000000,"view_count":"9","like_count":2}]}}`)),
		}, nil
	})}

	execRe := `INSERT INTO public\.social_libraries`
	mock.ExpectExec(execRe).
		WithArgs("tiktok:u1:v1", "u1", "ti", "su", "su", "cu", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "v1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	fetched, upserted, err := (TikTokProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 1 || upserted != 1 {
		t.Fatalf("expected 1/1, got %d/%d", fetched, upserted)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestTikTokProvider_SyncUser_MissingScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='tiktok_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t","openId":"o","scope":"user.info.basic"}`)))

	fetched, upserted, err := (TikTokProvider{}).SyncUser(context.Background(), db, "u1", nil, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestYouTubeProvider_SyncUser_EmptyChannels(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='youtube_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		// Only the first call matters for this test (channels?mine=true)
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"items":[]}`)),
		}, nil
	})}

	fetched, upserted, err := (YouTubeProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestYouTubeProvider_SyncUser_NoUploadsPlaylistID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='youtube_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"items":[{"id":"ch1","snippet":{"title":"chan"},"contentDetails":{"relatedPlaylists":{"uploads":""}}}]}`)),
		}, nil
	})}

	fetched, upserted, err := (YouTubeProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestYouTubeProvider_SyncUser_EmptyPlaylistItems(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT value FROM public.user_settings WHERE user_id=$1 AND key='youtube_oauth' AND value IS NOT NULL`)).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"t"}`)))

	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(r.URL.Path, "/youtube/v3/channels"):
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"items":[{"id":"ch1","snippet":{"title":"chan"},"contentDetails":{"relatedPlaylists":{"uploads":"upl"}}}]}`)),
			}, nil
		case strings.Contains(r.URL.Path, "/youtube/v3/playlistItems"):
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"items":[]}`)),
			}, nil
		default:
			return &http.Response{
				StatusCode: 500,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"error":"unexpected"}`)),
			}, nil
		}
	})}

	fetched, upserted, err := (YouTubeProvider{}).SyncUser(context.Background(), db, "u1", client, nil, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("SyncUser: %v", err)
	}
	if fetched != 0 || upserted != 0 {
		t.Fatalf("expected 0/0, got %d/%d", fetched, upserted)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestInstagramProvider_SyncUser_LimiterWaitError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	lim := rate.NewLimiter(rate.Limit(1), 1)
	_, _, err := (InstagramProvider{}).SyncUser(ctx, nil, "u1", nil, lim, log.New(io.Discard, "", 0))
	if err == nil {
		t.Fatalf("expected error")
	}
}
