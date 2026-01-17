package handlers

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

func TestGetUser_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	now := time.Now().UTC()
	mock.ExpectQuery(`SELECT id, email, name, image_url, created_at, profile FROM public\.users WHERE id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "name", "imageUrl", "createdAt", "profile"}).
			AddRow("u1", "e@example.com", "Alice", nil, now, nil))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/users/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"id": "u1"})
	h.GetUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d", rr.Code)
	}
	_ = mock.ExpectationsWereMet()
}

func TestUpdatePostForUser_ValidationBranches(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/posts/p1/user/u1", bytes.NewBufferString(`{"status":""}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
	h.UpdatePostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/posts/p1/user/u1", bytes.NewBufferString(`{"status":"scheduled"}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
	h.UpdatePostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestDeleteSocialLibrariesForUser_ValidationBranches(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-libraries/delete/user/u1", bytes.NewBufferString("{"))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.DeleteSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	// 201 unique ids -> too many
	ids := make([]string, 0, 201)
	for i := 0; i < 201; i++ {
		ids = append(ids, "id_"+time.Unix(int64(i), 0).Format("150405"))
	}
	body := `{"ids":[` + func() string {
		out := ""
		for i, id := range ids {
			if i > 0 {
				out += ","
			}
			out += `"` + id + `"`
		}
		return out
	}() + `]}`

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/social-libraries/delete/user/u1", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.DeleteSocialLibrariesForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestListSunoTracksForUser_Validation(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/suno/tracks/user/", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": ""})
	h.ListSunoTracksForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestGetUserSettings_QueryError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	mock.ExpectQuery(`SELECT key, value FROM public\.user_settings WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/user-settings/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.GetUserSettings(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 got %d", rr.Code)
	}
	_ = mock.ExpectationsWereMet()
}

func TestUploadUploadsForUser_ValidationBranches(t *testing.T) {
	h := New(nil)

	// missing multipart
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/user/u1", bytes.NewBufferString(`x`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.UploadUploadsForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	// too many files (31)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for i := 0; i < 31; i++ {
		fw, _ := mw.CreateFormFile("files", "f.txt")
		_, _ = fw.Write([]byte("x"))
	}
	_ = mw.Close()

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/uploads/user/u1", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.UploadUploadsForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestUploadUploadsForUser_MissingFilesAndMediaFallback(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	h := New(nil)

	// multipart but no files/media -> "missing files"
	{
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		_ = mw.WriteField("x", "y")
		_ = mw.Close()
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/uploads/user/u1", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
		h.UploadUploadsForUser(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 got %d body=%q", rr.Code, rr.Body.String())
		}
	}

	// media fallback field works
	{
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("media", "a.jpg")
		_, _ = fw.Write([]byte{0xff, 0xd8, 0xff, 0xdb})
		_ = mw.Close()
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/uploads/user/u1", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
		h.UploadUploadsForUser(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
		}
	}
}
