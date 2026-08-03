package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gorilla/mux"
)

type instagramAgentRoundTripFunc func(*http.Request) (*http.Response, error)

func (f instagramAgentRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func useInstagramAgentTransport(t *testing.T, fn instagramAgentRoundTripFunc) {
	t.Helper()
	previous := instagramAgentHTTPClient
	instagramAgentHTTPClient = &http.Client{Transport: fn}
	t.Cleanup(func() { instagramAgentHTTPClient = previous })
}

func TestBuildInstagramContentPrompt(t *testing.T) {
	include := true
	prompt, err := buildInstagramContentPrompt(instagramContentRequest{
		Type: "post", Input: "new coffee blend", Style: "casual", IncludeHashtags: &include,
	})
	if err != nil {
		t.Fatalf("build prompt: %v", err)
	}
	for _, want := range []string{"new coffee blend", "Style: casual", "10-15 relevant hashtags", "Return only the caption"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt %q does not contain %q", prompt, want)
		}
	}

	if _, err := buildInstagramContentPrompt(instagramContentRequest{Type: "hashtags", Input: "x", Count: 31}); err == nil {
		t.Fatal("expected invalid hashtag count error")
	}
}

func TestGenerateInstagramContentSync(t *testing.T) {
	useInstagramAgentTransport(t, func(r *http.Request) (*http.Response, error) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("authorization = %q", got)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode upstream body: %v", err)
		}
		if body["model"] != "test-model" || body["stream"] != false {
			t.Fatalf("unexpected upstream body: %#v", body)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"Fresh coffee, brighter mornings."}}]}`)),
		}, nil
	})
	t.Setenv("LLM_API_KEY", "test-key")
	t.Setenv("LLM_BASE_URL", "https://llm.example/v1")
	t.Setenv("LLM_MODEL", "test-model")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/instagram-agent/generate/user/u1", bytes.NewBufferString(`{"type":"post","input":"coffee","stream":false}`))
	New(nil).GenerateInstagramContent(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	var result map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result["content"] != "Fresh coffee, brighter mornings." || result["model"] != "test-model" {
		t.Fatalf("unexpected response: %#v", result)
	}
}

func TestGenerateInstagramContentStream(t *testing.T) {
	useInstagramAgentTransport(t, func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: [DONE]\n\n")),
		}, nil
	})
	t.Setenv("LLM_API_KEY", "test-key")
	t.Setenv("LLM_BASE_URL", "https://llm.example/v1")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/instagram-agent/generate/user/u1", bytes.NewBufferString(`{"type":"chat","input":"hello","stream":true}`))
	New(nil).GenerateInstagramContent(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Header().Get("Content-Type"), "text/event-stream") || !strings.Contains(rr.Body.String(), `"content":"Hello"`) {
		t.Fatalf("status=%d headers=%v body=%s", rr.Code, rr.Header(), rr.Body.String())
	}
}

func TestGenerateInstagramImage(t *testing.T) {
	useInstagramAgentTransport(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://images.example/generate" {
			t.Fatalf("unexpected endpoint %s", r.URL)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["size"] != "1024x1024" || body["model"] != "flux-test" {
			t.Fatalf("unexpected image request: %#v", body)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"data":[{"url":"https://cdn.example/image.png"}]}`))}, nil
	})
	t.Setenv("LLM_API_KEY", "test-key")
	t.Setenv("LLM_IMAGE_ENDPOINT", "https://images.example/generate")
	t.Setenv("LLM_IMAGE_MODEL", "flux-test")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/instagram-agent/image/user/u1", bytes.NewBufferString(`{"prompt":"coffee on a table"}`))
	New(nil).GenerateInstagramImage(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "https://cdn.example/image.png") {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestGetInstagramAccount(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT value FROM public\.user_settings`).WithArgs("u1").WillReturnRows(
		sqlmock.NewRows([]string{"value"}).AddRow([]byte(`{"accessToken":"token","igBusinessId":"ig-1"}`)),
	)

	useInstagramAgentTransport(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v24.0/ig-1" || r.URL.Query().Get("access_token") != "token" {
			t.Fatalf("unexpected graph request %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"ig-1","username":"coffee"}`))}, nil
	})
	t.Setenv("META_GRAPH_BASE_URL", "https://graph.example/v24.0")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/instagram-agent/account/user/u1", nil)
	req = mux.SetURLVars(req, map[string]string{"userId": "u1"})
	New(db).GetInstagramAccount(rr, req)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"username":"coffee"`) {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFlattenInstagramInsights(t *testing.T) {
	result := flattenInstagramInsights(map[string]interface{}{
		"data": []interface{}{
			map[string]interface{}{"name": "reach", "values": []interface{}{map[string]interface{}{"value": float64(42)}}},
			map[string]interface{}{"name": "profile_views", "total_value": map[string]interface{}{"value": float64(9)}},
		},
	})
	if result["reach"] != float64(42) || result["profile_views"] != float64(9) {
		t.Fatalf("unexpected flattened metrics: %#v", result)
	}
}
