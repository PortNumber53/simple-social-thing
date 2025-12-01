package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
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
	"github.com/lib/pq"
)

func TestListPostsForUser_NoStatus(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	now := time.Now().UTC()
	rows := sqlmock.NewRows([]string{
		"id", "teamId", "userId", "content", "status", "providers", "media",
		"scheduledFor", "publishedAt",
		"lastPublishJobId", "lastPublishStatus", "lastPublishError", "lastPublishAttemptAt",
		"createdAt", "updatedAt",
	}).
		AddRow("p1", "", "u1", sql.NullString{Valid: true, String: "hi"}, "draft", pq.StringArray{"instagram"}, pq.StringArray{}, sql.NullTime{}, sql.NullTime{}, sql.NullString{}, sql.NullString{}, sql.NullString{}, sql.NullTime{}, now, now)

	mock.ExpectQuery(`FROM public\."Posts"\s+WHERE "userId" = \$1`).
		WithArgs("u1", 200).
		WillReturnRows(rows)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/posts/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListPostsForUser(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var out []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if len(out) != 1 || out[0]["id"] != "p1" {
		t.Fatalf("unexpected response %#v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestListPostsForUser_WithStatus(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	now := time.Now().UTC()
	rows := sqlmock.NewRows([]string{
		"id", "teamId", "userId", "content", "status", "providers", "media",
		"scheduledFor", "publishedAt",
		"lastPublishJobId", "lastPublishStatus", "lastPublishError", "lastPublishAttemptAt",
		"createdAt", "updatedAt",
	}).
		AddRow("p2", "", "u1", sql.NullString{Valid: false}, "scheduled", pq.StringArray{"facebook"}, pq.StringArray{}, sql.NullTime{}, sql.NullTime{}, sql.NullString{}, sql.NullString{}, sql.NullString{}, sql.NullTime{}, now, now)

	mock.ExpectQuery(`FROM public\."Posts"\s+WHERE "userId" = \$1 AND status = \$2`).
		WithArgs("u1", "scheduled", 200).
		WillReturnRows(rows)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/posts/user/u1?status=scheduled", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListPostsForUser(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestCreatePostForUser_ValidationErrors(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/posts/user/u1", bytes.NewBufferString(`{"status":"nope"}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.CreatePostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/posts/user/u1", bytes.NewBufferString(`{"status":"scheduled"}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.CreatePostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/posts/user/u1", bytes.NewBufferString(`{"status":"scheduled","scheduledFor":"2026-01-01T00:00:00Z"}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.CreatePostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestCreatePostForUser_MethodNotAllowed_AndBadJSON(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/posts/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.CreatePostForUser(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/posts/user/u1", bytes.NewBufferString("{"))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.CreatePostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestCreatePostForUser_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()
	h := New(db)

	id := "p1"
	content := "hello"
	status := "draft"
	now := time.Now().UTC()

	mock.ExpectQuery(`INSERT INTO public\."Posts"`).
		WithArgs(id, "u1", &content, status, sqlmock.AnyArg(), sqlmock.AnyArg(), (*time.Time)(nil), (*time.Time)(nil)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "teamId", "userId", "content", "status", "providers", "media",
			"scheduledFor", "publishedAt",
			"lastPublishJobId", "lastPublishStatus", "lastPublishError", "lastPublishAttemptAt",
			"createdAt", "updatedAt",
		}).
			AddRow(id, "", "u1", sql.NullString{Valid: true, String: content}, status, pq.StringArray{}, pq.StringArray{}, sql.NullTime{}, sql.NullTime{}, sql.NullString{}, sql.NullString{}, sql.NullString{}, sql.NullTime{}, now, now))

	body, _ := json.Marshal(map[string]any{"id": id, "content": content, "status": status})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/posts/user/u1", bytes.NewReader(body))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.CreatePostForUser(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestUpdatePostForUser_NotFoundAndSuccess(t *testing.T) {
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		h := New(db)

		mock.ExpectQuery(`UPDATE public\."Posts"`).
			WillReturnError(sql.ErrNoRows)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/posts/p1/user/u1", bytes.NewBufferString(`{}`))
		req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
		h.UpdatePostForUser(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 got %d body=%q", rr.Code, rr.Body.String())
		}
		_ = db.Close()
		_ = mock.ExpectationsWereMet()
	}

	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		newContent := "c2"
		newStatus := "scheduled"
		when := time.Now().UTC().Add(1 * time.Hour)
		now := time.Now().UTC()

		mock.ExpectQuery(`UPDATE public\."Posts"`).
			WithArgs("p1", "u1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnRows(sqlmock.NewRows([]string{
				"id", "teamId", "userId", "content", "status", "providers", "media",
				"scheduledFor", "publishedAt",
				"lastPublishJobId", "lastPublishStatus", "lastPublishError", "lastPublishAttemptAt",
				"createdAt", "updatedAt",
			}).
				AddRow("p1", "", "u1", sql.NullString{Valid: true, String: newContent}, newStatus, pq.StringArray{"instagram"}, pq.StringArray{}, sql.NullTime{Valid: true, Time: when}, sql.NullTime{}, sql.NullString{}, sql.NullString{}, sql.NullString{}, sql.NullTime{}, now, now))

		body, _ := json.Marshal(map[string]any{"content": newContent, "status": newStatus, "scheduledFor": when})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/posts/p1/user/u1", bytes.NewReader(body))
		req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
		h.UpdatePostForUser(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("sql expectations: %v", err)
		}
	}
}

func TestUpdatePostForUser_MethodAndBodyValidation(t *testing.T) {
	// method not allowed
	{
		h := New(nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/posts/p1/user/u1", nil)
		req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
		h.UpdatePostForUser(rr, req)
		if rr.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected 405 got %d", rr.Code)
		}
	}

	// invalid json body
	{
		h := New(nil)
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/posts/p1/user/u1", bytes.NewBufferString("{"))
		req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
		h.UpdatePostForUser(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 got %d", rr.Code)
		}
	}

	// internal db error path
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectQuery(`UPDATE public\."Posts"`).
			WillReturnError(sql.ErrConnDone)

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/posts/p1/user/u1", bytes.NewBufferString(`{"content":"x"}`))
		req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
		h.UpdatePostForUser(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 got %d body=%q", rr.Code, rr.Body.String())
		}
		_ = mock.ExpectationsWereMet()
	}
}

func TestDeletePostForUser_NotFoundAndSuccess(t *testing.T) {
	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectExec(`DELETE FROM public\."Posts"`).
			WithArgs("p1", "u1").
			WillReturnResult(sqlmock.NewResult(0, 0))

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodDelete, "/api/posts/p1/user/u1", nil)
		req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
		h.DeletePostForUser(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("expected 404 got %d", rr.Code)
		}
	}

	{
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer func() { _ = db.Close() }()
		h := New(db)

		mock.ExpectExec(`DELETE FROM public\."Posts"`).
			WithArgs("p1", "u1").
			WillReturnResult(sqlmock.NewResult(0, 1))

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodDelete, "/api/posts/p1/user/u1", nil)
		req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
		h.DeletePostForUser(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
		}
	}
}

func TestListPostsAndDeletePost_MethodAndParamValidation(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/posts/user/", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": ""})
	h.ListPostsForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/posts/p1/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1", "postId": "p1"})
	h.DeletePostForUser(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 got %d", rr.Code)
	}
}

func TestUploadKind(t *testing.T) {
	if uploadKind("image/png", "x.bin") != "image" {
		t.Fatalf("expected image")
	}
	if uploadKind("video/mp4", "x.bin") != "video" {
		t.Fatalf("expected video")
	}
	if uploadKind("", "x.mp4") != "video" {
		t.Fatalf("expected ext-based video")
	}
	if uploadKind("", "x.jpg") != "image" {
		t.Fatalf("expected ext-based image")
	}
	if uploadKind("", "x.bin") != "other" {
		t.Fatalf("expected other")
	}
}

func TestListUploadsForUser_EmptyAndPopulated(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	h := New(nil)

	// Missing dir => empty list
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/uploads/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListUploadsForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}

	// Create two files
	userHash := mediaUserHash("u1")
	dir1 := filepath.Join("media", userHash, "aaaaa")
	dir2 := filepath.Join("media", userHash, "bbbbb")
	_ = os.MkdirAll(dir1, 0o755)
	_ = os.MkdirAll(dir2, 0o755)
	_ = os.WriteFile(filepath.Join(dir1, "a.jpg"), []byte{0xff, 0xd8, 0xff}, 0o644)
	_ = os.WriteFile(filepath.Join(dir2, "b.mp4"), []byte{0x00, 0x00, 0x00, 0x18}, 0o644)

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/uploads/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.ListUploadsForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var out uploadsListResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if !out.OK || len(out.Items) < 2 {
		t.Fatalf("unexpected response: %+v", out)
	}
}

func TestUploadAndDeleteUploadsForUser(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	h := New(nil)

	// Upload one file via multipart
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("files", "x.jpg")
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
	var up uploadsUploadResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &up)
	if !up.OK || len(up.Items) != 1 {
		t.Fatalf("unexpected upload response: %+v", up)
	}

	// Delete: include invalid id + duplicate; should delete the existing one.
	delBody, _ := json.Marshal(map[string]any{"ids": []string{"../bad", up.Items[0].ID, up.Items[0].ID}})
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/uploads/delete/user/u1", bytes.NewReader(delBody))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.DeleteUploadsForUser(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%q", rr.Code, rr.Body.String())
	}
	var del deleteUploadsResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &del)
	if !del.OK || del.Deleted < 1 {
		t.Fatalf("unexpected delete response: %+v", del)
	}
	// Ensure the newly uploaded file is deleted (path derived from returned URL).
	rel := strings.TrimPrefix(up.Items[0].URL, "/media/")
	local := filepath.Clean(filepath.Join("media", rel))
	if _, err := os.Stat(local); err == nil {
		t.Fatalf("expected file deleted")
	}
}

func TestMin(t *testing.T) {
	if min(1, 2) != 1 {
		t.Fatalf("expected 1")
	}
	if min(3, 2) != 2 {
		t.Fatalf("expected 2")
	}
}

func TestUploadUploadsForUser_MethodNotAllowed(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/uploads/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.UploadUploadsForUser(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 got %d", rr.Code)
	}
}

func TestDeleteUploadsForUser_ValidatesIDs(t *testing.T) {
	tmp := t.TempDir()
	cwd, _ := os.Getwd()
	_ = os.Chdir(tmp)
	defer func() { _ = os.Chdir(cwd) }()

	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/delete/user/u1", bytes.NewBufferString(`{"ids":[]}`))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.DeleteUploadsForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	// Too many ids
	ids := make([]string, 0, 205)
	for i := 0; i < 205; i++ {
		ids = append(ids, fmt.Sprintf("x%03d", i))
	}
	body, _ := json.Marshal(map[string]any{"ids": ids})
	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/uploads/delete/user/u1", bytes.NewReader(body))
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.DeleteUploadsForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}
