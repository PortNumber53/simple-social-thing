package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func TestRequireMethod(t *testing.T) {
	t.Run("wrong method", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		rr := httptest.NewRecorder()

		ok := requireMethod(rr, req, http.MethodPost)
		if ok {
			t.Fatalf("expected ok=false")
		}
		if rr.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, rr.Code)
		}
	})

	t.Run("right method", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		rr := httptest.NewRecorder()

		ok := requireMethod(rr, req, http.MethodPost)
		if !ok {
			t.Fatalf("expected ok=true")
		}
		// No status written yet.
		if rr.Code != http.StatusOK {
			t.Fatalf("expected default recorder status %d, got %d", http.StatusOK, rr.Code)
		}
	})
}

func TestWriteJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	writeJSON(rr, http.StatusCreated, map[string]any{"ok": true})

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %q", ct)
	}
	if body := rr.Body.String(); body == "" || body[0] != '{' {
		t.Fatalf("expected json body, got %q", body)
	}
}

func TestDecodeJSON(t *testing.T) {
	type payload struct {
		A string `json:"a"`
	}
	req := httptest.NewRequest(http.MethodPost, "/x", bytes.NewBufferString(`{"a":"b"}`))

	var out payload
	if err := decodeJSON(req, &out); err != nil {
		t.Fatalf("decodeJSON error: %v", err)
	}
	if out.A != "b" {
		t.Fatalf("expected a=b, got %q", out.A)
	}
}

func TestDecodeJSON_Invalid(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/x", bytes.NewBufferString(`not-json`))
	var out map[string]any
	if err := decodeJSON(req, &out); err == nil {
		t.Fatalf("expected error")
	}
}

func TestPathVar(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/users/123", nil)
	req = mux.SetURLVars(req, map[string]string{"id": "123"})

	if got := pathVar(req, "id"); got != "123" {
		t.Fatalf("expected id=123, got %q", got)
	}
	if got := pathVar(req, "missing"); got != "" {
		t.Fatalf("expected missing var to be empty string, got %q", got)
	}
}

func TestWriteError(t *testing.T) {
	rr := httptest.NewRecorder()
	writeError(rr, http.StatusBadRequest, "nope")

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, rr.Code)
	}
	// http.Error writes text/plain; charset=utf-8 and appends a newline.
	if body := rr.Body.String(); body != "nope\n" {
		t.Fatalf("expected body %q, got %q", "nope\n", body)
	}
}
