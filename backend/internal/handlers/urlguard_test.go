package handlers

import (
	"net"
	"testing"
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
