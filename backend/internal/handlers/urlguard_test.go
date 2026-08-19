package handlers

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestValidateURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"valid https", "https://example.com/image.jpg", false},
		{"valid http", "http://example.com/audio.mp3", false},
		{"javascript scheme", "javascript:alert(1)", true},
		{"file scheme", "file:///etc/passwd", true},
		{"ftp scheme", "ftp://example.com/file", true},
		{"empty string", "", true},
		{"missing scheme", "example.com/file", true},
		{"loopback IPv4", "http://127.0.0.1/admin", true},
		{"loopback IPv6", "http://[::1]/admin", true},
		{"private 10.x", "http://10.0.0.1/internal", true},
		{"private 172.16.x", "http://172.16.0.1/internal", true},
		{"private 192.168.x", "http://192.168.1.1/internal", true},
		{"link-local", "http://169.254.169.254/latest/meta-data/", true},
		{"unspecified", "http://0.0.0.0/", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateURL(tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateURL(%q) error = %v, wantErr %v", tt.url, err, tt.wantErr)
			}
		})
	}
}

func TestIsBlockedIP(t *testing.T) {
	tests := []struct {
		name    string
		ip      string
		blocked bool
	}{
		{"loopback", "127.0.0.1", true},
		{"loopback v6", "::1", true},
		{"private 10", "10.1.2.3", true},
		{"private 172", "172.16.0.1", true},
		{"private 192", "192.168.1.1", true},
		{"link-local", "169.254.1.1", true},
		{"aws metadata", "169.254.169.254", true},
		{"unspecified", "0.0.0.0", true},
		{"public", "8.8.8.8", false},
		{"public v6", "2001:4860:4860::8888", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ip := net.ParseIP(tt.ip)
			if ip == nil {
				t.Fatalf("failed to parse IP %s", tt.ip)
			}
			if got := isBlockedIP(ip); got != tt.blocked {
				t.Errorf("isBlockedIP(%s) = %v, want %v", tt.ip, got, tt.blocked)
			}
		})
	}
}

func TestSanitizeURLForLog(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"removes credentials", "https://user:pass@example.com/path", "https://example.com/path"},
		{"no credentials", "https://example.com/path", "https://example.com/path"},
		{"invalid url", "://broken", "[invalid-url]"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeURLForLog(tt.url); got != tt.want {
				t.Errorf("sanitizeURLForLog(%q) = %q, want %q", tt.url, got, tt.want)
			}
		})
	}
}

func TestIsAllowedExternalHost(t *testing.T) {
	allowlist := []string{"example.com", "example.org"}

	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"allowed domain", "https://example.com/file.mp3", false},
		{"allowed subdomain", "https://www.example.com/track", false},
		{"disallowed domain", "https://evil.com/file.mp3", true},
		{"localhost blocked", "http://localhost/admin", true},
		{"private IP blocked", "http://10.0.0.1/internal", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := isAllowedExternalHost(tt.url, allowlist)
			if (err != nil) != tt.wantErr {
				t.Errorf("isAllowedExternalHost(%q) error = %v, wantErr %v", tt.url, err, tt.wantErr)
			}
		})
	}
}

func TestSSRFSafeTransportBlocksLoopback(t *testing.T) {
	// Start a local server that we must NOT be able to reach.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := safeSSRFClient(5 * time.Second)
	// httptest.Server listens on 127.0.0.1, so the SSRF guard must block it.
	resp, err := client.Get(srv.URL)
	if err == nil {
		resp.Body.Close()
		t.Fatalf("expected SSRF guard to block loopback URL %s, but request succeeded", srv.URL)
	}
	if !strings.Contains(err.Error(), "SSRF guard") {
		t.Fatalf("expected error to mention SSRF guard, got: %v", err)
	}
}

func TestSSRFSafeTransportAllowsPublic(t *testing.T) {
	// Use a public IP literal that is not blocked.  We don't actually need
	// the connection to succeed — we just need the DialContext to not reject
	// the address as blocked.  A connection refused or timeout error is fine.
	tr := ssrfSafeTransport()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := tr.DialContext(ctx, "tcp", "8.8.8.8:80")
	if err != nil && strings.Contains(err.Error(), "SSRF guard") {
		t.Fatalf("SSRF guard incorrectly blocked public IP 8.8.8.8: %v", err)
	}
}

func TestSSRFSafeTransportBlocksPrivateIP(t *testing.T) {
	tr := ssrfSafeTransport()
	_, err := tr.DialContext(context.Background(), "tcp", "10.0.0.1:80")
	if err == nil {
		t.Fatal("expected SSRF guard to block private IP 10.0.0.1")
	}
	if !strings.Contains(err.Error(), "SSRF guard") {
		t.Fatalf("expected error to mention SSRF guard, got: %v", err)
	}
}

func TestSSRFSafeTransportBlocksIPv6Loopback(t *testing.T) {
	tr := ssrfSafeTransport()
	_, err := tr.DialContext(context.Background(), "tcp", "[::1]:80")
	if err == nil {
		t.Fatal("expected SSRF guard to block IPv6 loopback ::1")
	}
	if !strings.Contains(err.Error(), "SSRF guard") {
		t.Fatalf("expected error to mention SSRF guard, got: %v", err)
	}
}

func TestSSRFSafeClientTimeout(t *testing.T) {
	c := safeSSRFClient(1 * time.Millisecond)
	if c.Timeout != 1*time.Millisecond {
		t.Fatalf("expected timeout 1ms, got %v", c.Timeout)
	}
	c0 := safeSSRFClient(0)
	if c0.Timeout != 0 {
		t.Fatalf("expected timeout 0, got %v", c0.Timeout)
	}
}

func TestSafeSSRFGetBlocksLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// safeSSRFGet should refuse to even create a request for a loopback URL.
	_, err := safeSSRFGet(context.Background(), srv.URL)
	if err == nil {
		t.Fatalf("expected safeSSRFGet to block loopback URL %s", srv.URL)
	}
	if !strings.Contains(err.Error(), "SSRF guard") {
		t.Fatalf("expected error to mention SSRF guard, got: %v", err)
	}
}

func TestSafeSSRFRequestRejectsBadScheme(t *testing.T) {
	_, _, err := safeSSRFRequest(context.Background(), "GET", "file:///etc/passwd")
	if err == nil {
		t.Fatal("expected error for file:// scheme")
	}
	if !strings.Contains(err.Error(), "unsupported scheme") {
		t.Fatalf("expected unsupported scheme error, got: %v", err)
	}
}

func TestSafeSSRFRequestRejectsPrivateIP(t *testing.T) {
	_, _, err := safeSSRFRequest(context.Background(), "GET", "http://192.168.1.1/admin")
	if err == nil {
		t.Fatal("expected error for private IP URL")
	}
	if !strings.Contains(err.Error(), "SSRF guard") {
		t.Fatalf("expected SSRF guard error, got: %v", err)
	}
}
