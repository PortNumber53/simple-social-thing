package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSafeFileServer_BlocksHTML(t *testing.T) {
	// Create a temporary directory with an HTML file.
	tmpDir := t.TempDir()
	htmlContent := `<html><script>alert("xss")</script></html>`
	if err := os.WriteFile(filepath.Join(tmpDir, "evil.html"), []byte(htmlContent), 0o644); err != nil {
		t.Fatal(err)
	}

	fs := http.StripPrefix("/", http.FileServer(http.Dir(tmpDir)))
	handler := safeFileServer(fs)

	req := httptest.NewRequest("GET", "/evil.html", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct != "application/octet-stream" {
		t.Errorf("expected Content-Type application/octet-stream for HTML, got %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != "attachment" {
		t.Errorf("expected Content-Disposition attachment, got %q", cd)
	}
}

func TestSafeFileServer_BlocksSVG(t *testing.T) {
	tmpDir := t.TempDir()
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>`
	if err := os.WriteFile(filepath.Join(tmpDir, "evil.svg"), []byte(svgContent), 0o644); err != nil {
		t.Fatal(err)
	}

	fs := http.StripPrefix("/", http.FileServer(http.Dir(tmpDir)))
	handler := safeFileServer(fs)

	req := httptest.NewRequest("GET", "/evil.svg", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct != "application/octet-stream" {
		t.Errorf("expected Content-Type application/octet-stream for SVG, got %q", ct)
	}
}

func TestSafeFileServer_AllowsImages(t *testing.T) {
	tmpDir := t.TempDir()
	// Minimal PNG header
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	if err := os.WriteFile(filepath.Join(tmpDir, "image.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}

	fs := http.StripPrefix("/", http.FileServer(http.Dir(tmpDir)))
	handler := safeFileServer(fs)

	req := httptest.NewRequest("GET", "/image.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct != "image/png" {
		t.Errorf("expected Content-Type image/png for PNG, got %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd == "attachment" {
		t.Errorf("should not force attachment for safe image types")
	}
}

func TestSafeFileServer_BlocksJavaScript(t *testing.T) {
	tmpDir := t.TempDir()
	jsContent := `alert("xss")`
	if err := os.WriteFile(filepath.Join(tmpDir, "evil.js"), []byte(jsContent), 0o644); err != nil {
		t.Fatal(err)
	}

	fs := http.StripPrefix("/", http.FileServer(http.Dir(tmpDir)))
	handler := safeFileServer(fs)

	req := httptest.NewRequest("GET", "/evil.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct != "application/octet-stream" {
		t.Errorf("expected Content-Type application/octet-stream for JS, got %q", ct)
	}
}

func TestSafeFileServer_BlocksXML(t *testing.T) {
	tmpDir := t.TempDir()
	xmlContent := `<?xml version="1.0"?><foo>bar</foo>`
	if err := os.WriteFile(filepath.Join(tmpDir, "evil.xml"), []byte(xmlContent), 0o644); err != nil {
		t.Fatal(err)
	}

	fs := http.StripPrefix("/", http.FileServer(http.Dir(tmpDir)))
	handler := safeFileServer(fs)

	req := httptest.NewRequest("GET", "/evil.xml", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct != "application/octet-stream" {
		t.Errorf("expected Content-Type application/octet-stream for XML, got %q", ct)
	}
}
