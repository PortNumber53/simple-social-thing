package handlers

import (
	"fmt"
	"path/filepath"
	"strings"
)

// safeMediaJoin joins a user-provided relative path (from a /media/... URL)
// onto the media root directory and ensures the result stays within the
// media directory. This prevents path traversal (../../etc/passwd) attacks.
//
// The rel parameter is expected to be the portion of the path after
// "/media/" (e.g. "uploads/userid/file.mp3"). The function returns an
// absolute path on success, or an error if the resolved path escapes the
// media directory.
func safeMediaJoin(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", fmt.Errorf("empty path")
	}
	// Strip any leading slashes to prevent absolute path injection.
	rel = strings.TrimPrefix(rel, "/")
	joined := filepath.Clean(filepath.Join("media", rel))
	absJoined, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	absMedia, err := filepath.Abs("media")
	if err != nil {
		return "", err
	}
	absMedia = filepath.Clean(absMedia) + string(filepath.Separator)
	if !strings.HasPrefix(absJoined, absMedia) {
		return "", fmt.Errorf("path escapes media directory")
	}
	return absJoined, nil
}

// sanitizePathComponent removes path separators and parent-directory
// references from a single path component (e.g. a filename or ID) so it
// is safe to use in filepath.Join. This is used for user-provided values
// like track IDs that are used to construct file paths.
func sanitizePathComponent(s string) string {
	s = strings.TrimSpace(s)
	// Remove any path separators or parent references.
	s = strings.ReplaceAll(s, "/", "_")
	s = strings.ReplaceAll(s, "\\", "_")
	s = strings.ReplaceAll(s, "..", "_")
	// Strip leading dots to prevent hidden files / relative paths.
	s = strings.TrimLeft(s, "._")
	if s == "" {
		s = "unknown"
	}
	return s
}
