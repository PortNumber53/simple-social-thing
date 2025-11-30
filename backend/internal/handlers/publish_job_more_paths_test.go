package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func TestGetPublishJob_MethodNotAllowed_AndMissingJobID(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-posts/publish-jobs/x", nil)
	req = mux.SetURLVars(req, map[string]string{"jobId": "x"})
	h.GetPublishJob(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/social-posts/publish-jobs/", nil)
	req = mux.SetURLVars(req, map[string]string{"jobId": ""})
	h.GetPublishJob(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestEnqueuePublishJobForUser_InvalidJSON_AndMissingUserID(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-posts/publish-async/user/", bytes.NewBufferString(`{"caption":"x"}`))
	req = mux.SetURLVars(req, map[string]string{"userId": ""})
	h.EnqueuePublishJobForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/social-posts/publish-async/user/u1", bytes.NewBufferString("{"))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.EnqueuePublishJobForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestPublishSocialPostForUser_MethodNotAllowed_AndMissingUserID(t *testing.T) {
	h := New(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/social-posts/publish/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.PublishSocialPostForUser(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/social-posts/publish/user/", bytes.NewBufferString(`{"caption":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"userId": ""})
	h.PublishSocialPostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}

func TestPublishSocialPostForUser_CaptionRequired(t *testing.T) {
	h := New(nil)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/social-posts/publish/user/u1", bytes.NewBufferString(`{"caption":"  "}`))
	req.Header.Set("Content-Type", "application/json")
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	h.PublishSocialPostForUser(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", rr.Code)
	}
}
