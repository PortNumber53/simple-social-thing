package handlers

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeMediaJoin(t *testing.T) {
	tests := []struct {
		name    string
		rel     string
		wantErr bool
	}{
		{"valid path", "uploads/userid/file.mp4", false},
		{"valid nested path", "userhash/folders/Exports/video-editor/file.mp4", false},
		{"empty string", "", true},
		{"whitespace only", "   ", true},
		{"path traversal", "../../etc/passwd", true},
		{"double dot in middle", "uploads/../etc/passwd", false}, // resolves to media/etc/passwd, still inside media
		{"absolute path", "/etc/passwd", false},                  // gets joined under media/
		{"with leading slash", "/uploads/file.mp4", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := safeMediaJoin(tt.rel)
			if (err != nil) != tt.wantErr {
				t.Errorf("safeMediaJoin(%q) error = %v, wantErr %v", tt.rel, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			// Verify the result is within the media directory.
			absMedia, _ := filepath.Abs("media")
			absMedia = filepath.Clean(absMedia) + string(filepath.Separator)
			if !strings.HasPrefix(got, absMedia) {
				t.Errorf("safeMediaJoin(%q) = %q, expected to be within %s", tt.rel, got, absMedia)
			}
		})
	}
}

func TestSafeMediaJoinTraversalBlocked(t *testing.T) {
	// This is the critical test: a path with ../ must not escape the media dir.
	path, err := safeMediaJoin("uploads/../../../etc/passwd")
	if err == nil {
		t.Errorf("expected error for path traversal, got path: %s", path)
	}
	if err != nil && !strings.Contains(err.Error(), "escapes") {
		t.Errorf("expected 'escapes' error, got: %v", err)
	}
}

func TestSanitizePathComponent(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"normal id", "abc123", "abc123"},
		{"with slashes", "foo/bar", "foo_bar"},
		{"with backslashes", "foo\\bar", "foo_bar"},
		{"with double dots", "../etc", "etc"},
		{"leading dots", "...hidden", "hidden"},
		{"empty string", "", "unknown"},
		{"whitespace only", "   ", "unknown"},
		{"path traversal", "../../etc/passwd", "etc_passwd"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizePathComponent(tt.input)
			if got != tt.want {
				t.Errorf("sanitizePathComponent(%q) = %q, want %q", tt.input, got, tt.want)
			}
			// Ensure no path separators or .. remain.
			if strings.Contains(got, "/") || strings.Contains(got, "\\") {
				t.Errorf("sanitizePathComponent(%q) = %q, contains path separator", tt.input, got)
			}
			if strings.Contains(got, "..") {
				t.Errorf("sanitizePathComponent(%q) = %q, contains ..", tt.input, got)
			}
		})
	}
}
