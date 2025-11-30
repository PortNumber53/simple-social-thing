package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestPublishSocialPostForUser_FacebookAndInstagram_DryRun(t *testing.T) {
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

	// OAuth rows needed by facebook + instagram branches
	fbPayload := fbOAuthPayload{Pages: []fbOAuthPageRow{{ID: "pg1", AccessToken: "ptok", Tasks: []string{"CREATE_CONTENT"}}}}
	fbRaw, _ := json.Marshal(fbPayload)
	mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='facebook_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(fbRaw))

	igPayload := instagramOAuth{AccessToken: "igtok", IGBusinessID: "ig1"}
	igRaw, _ := json.Marshal(igPayload)
	mock.ExpectQuery(`SELECT value FROM public\."UserSettings".*key='instagram_oauth'`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(igRaw))

	// Build multipart request with one media file so Instagram branch has media.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("caption", "cap")
	_ = mw.WriteField("dryRun", "true")
	_ = mw.WriteField("facebookPageIds", `["pg1"]`)
	fw, _ := mw.CreateFormFile("media", "img.jpg")
	_, _ = fw.Write([]byte{0xff, 0xd8, 0xff, 0xdb})
	_ = mw.Close()

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-posts/publish/user/u1", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})

	h.PublishSocialPostForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
