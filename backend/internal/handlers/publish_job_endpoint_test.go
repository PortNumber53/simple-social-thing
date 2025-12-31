package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
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

func TestParsePublishPostRequest_MultipartPath(t *testing.T) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("caption", "hello")
	_ = mw.WriteField("dryRun", "true")
	_ = mw.WriteField("providers", `["tiktok","youtube"]`)
	_ = mw.WriteField("facebookPageIds", `["pg1"]`)

	// 6 files should be truncated to maxFiles=5 in parser.
	for i := 0; i < 6; i++ {
		fw, _ := mw.CreateFormFile("media", "f"+string(rune('a'+i))+".txt")
		_, _ = fw.Write([]byte("x"))
	}
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/x", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	parsed, media, err := parsePublishPostRequest(req)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.Caption != "hello" || !parsed.DryRun {
		t.Fatalf("unexpected parsed: %+v", parsed)
	}
	if len(parsed.Providers) != 2 || parsed.Providers[0] != "tiktok" {
		t.Fatalf("unexpected providers: %+v", parsed.Providers)
	}
	if len(parsed.FacebookPageIDs) != 1 || parsed.FacebookPageIDs[0] != "pg1" {
		t.Fatalf("unexpected fb page ids: %+v", parsed.FacebookPageIDs)
	}
	if len(media) != 5 {
		t.Fatalf("expected 5 media files got %d", len(media))
	}
}

func TestParsePublishPostRequest_Multipart_CommaSeparatedProviders(t *testing.T) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("caption", "hello")
	_ = mw.WriteField("providers", "tiktok,youtube")
	_ = mw.WriteField("facebookPageIds", "pg1,pg2")
	fw, _ := mw.CreateFormFile("media", "x.jpg")
	_, _ = fw.Write([]byte{0xff, 0xd8, 0xff, 0xdb})
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/x", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	parsed, media, err := parsePublishPostRequest(req)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(parsed.Providers) != 2 || parsed.Providers[0] != "tiktok" || len(parsed.FacebookPageIDs) != 2 {
		t.Fatalf("unexpected parsed: %+v", parsed)
	}
	if len(media) != 1 {
		t.Fatalf("expected 1 media got %d", len(media))
	}
}

func TestParsePublishPostRequest_JSON_Invalid(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/x", bytes.NewBufferString("{"))
	req.Header.Set("Content-Type", "application/json")
	_, _, err := parsePublishPostRequest(req)
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestEnqueuePublishJobForUser_Success_UnknownProvider(t *testing.T) {
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

	// Insert job row (jobID is rand)
	mock.ExpectExec(`INSERT INTO public\.publish_jobs`).
		WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), "cap", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Background job updates (unknown provider => no provider calls)
	mock.ExpectExec(`UPDATE public\.publish_jobs.*status='running'`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*last_publish_status='running'`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`UPDATE public\.publish_jobs.*SET status=\$2`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*SET last_publish_status=\$2`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))

	rr := httptest.NewRecorder()
	body := `{"caption":"cap","providers":["unknown"],"dryRun":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/social-posts/publish-async/user/u1", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.EnqueuePublishJobForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	// Give the goroutine time to run; it should complete quickly for "unknown" provider.
	time.Sleep(25 * time.Millisecond)

	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if out["jobId"] == "" {
		t.Fatalf("expected jobId in response got %#v", out)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestRunPublishJob_TikTokDryRun(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	// Media file for relMedia
	dir := filepath.Join("media", "uploads", "u1")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "v.mp4"), []byte{0x00, 0x01, 0x02, 0x03}, 0o644)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	mock.ExpectExec(`UPDATE public\.publish_jobs.*status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*last_publish_status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	tok := tiktokOAuth{AccessToken: "tt", OpenID: "oid", Scope: "video.upload,video.publish"}
	raw, _ := json.Marshal(tok)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='tiktok_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	mock.ExpectExec(`UPDATE public\.publish_jobs.*SET status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*SET last_publish_status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))

	h.runPublishJob("job1", "u1", "cap", publishPostRequest{Providers: []string{"tiktok"}, DryRun: true}, []string{"/media/uploads/u1/v.mp4"}, "https://app.test")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestRunPublishJob_FacebookCaptionOnly_Success(t *testing.T) {
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

	mock.ExpectExec(`UPDATE public\.publish_jobs.*status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*last_publish_status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	payload := fbOAuthPayload{Pages: []fbOAuthPageRow{{ID: "pg1", AccessToken: "ptok", Tasks: []string{"CREATE_CONTENT"}}}}
	raw, _ := json.Marshal(payload)
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='facebook_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(raw))

	// SocialLibraries upsert for caption-only post
	mock.ExpectExec(`INSERT INTO public\.social_libraries`).
		WithArgs(sqlmock.AnyArg(), "u1", "cap", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectExec(`UPDATE public\.publish_jobs.*SET status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*SET last_publish_status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))

	orig := http.DefaultTransport
	defer func() { http.DefaultTransport = orig }()
	http.DefaultTransport = stubTransport{fn: func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "graph.facebook.com" && strings.Contains(r.URL.Path, "/feed") && r.Method == "POST" {
			return httpJSON(200, `{"id":"post1"}`, nil), nil
		}
		return httpJSON(404, `{"error":"not_found"}`, nil), nil
	}}

	h.runPublishJob("job1", "u1", "cap", publishPostRequest{Providers: []string{"facebook"}, FacebookPageIDs: []string{"pg1"}}, nil, "https://app.test")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestRunPublishJob_MultiProviders_DryRun(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	// Media files for relMedia
	dir := filepath.Join("media", "uploads", "u1")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "img.jpg"), []byte{0xff, 0xd8, 0xff, 0xdb}, 0o644)
	_ = os.WriteFile(filepath.Join(dir, "vid.mp4"), []byte{0x00, 0x00, 0x00, 0x18}, 0o644)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	mock.ExpectExec(`UPDATE public\.publish_jobs.*status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*last_publish_status='running'`).
		WithArgs("job1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	igRaw, _ := json.Marshal(instagramOAuth{AccessToken: "igtok", IGBusinessID: "ig1"})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='instagram_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(igRaw))

	ttRaw, _ := json.Marshal(tiktokOAuth{AccessToken: "ttok", OpenID: "oid", Scope: "video.upload,video.publish"})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='tiktok_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(ttRaw))

	ytRaw, _ := json.Marshal(youtubeOAuth{AccessToken: "ytok", Scope: "https://www.googleapis.com/auth/youtube.upload", ExpiresAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339)})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='youtube_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(ytRaw))

	pinRaw, _ := json.Marshal(pinterestOAuth{AccessToken: "ptok", Scope: "pins:write,boards:read", ExpiresAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339)})
	mock.ExpectQuery(`SELECT value FROM public\.user_settings.*key='pinterest_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(pinRaw))

	mock.ExpectExec(`UPDATE public\.publish_jobs.*SET status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE public\.posts.*SET last_publish_status=\$2`).
		WithArgs("job1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))

	req := publishPostRequest{Providers: []string{"instagram", "tiktok", "youtube", "pinterest"}, DryRun: true}
	rel := []string{"/media/uploads/u1/img.jpg", "/media/uploads/u1/vid.mp4"}
	h.runPublishJob("job1", "u1", "cap", req, rel, "https://app.test")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
