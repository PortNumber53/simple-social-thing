package providers

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncate(t *testing.T) {
	if got := truncate("abc", 0); got != "abc" {
		t.Fatalf("expected unchanged for n<=0, got %q", got)
	}
	if got := truncate("abc", 2); got != "ab" {
		t.Fatalf("expected ab, got %q", got)
	}
	if got := truncate("abc", 5); got != "abc" {
		t.Fatalf("expected unchanged when shorter, got %q", got)
	}
}

func TestNormalizeTitle(t *testing.T) {
	if got := normalizeTitle("   "); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
	if got := normalizeTitle(" hi "); got != "hi" {
		t.Fatalf("expected trimmed, got %q", got)
	}
	long := ""
	for i := 0; i < 200; i++ {
		long += "a"
	}
	if got := normalizeTitle(long); len(got) != 160 {
		t.Fatalf("expected 160 chars, got %d", len(got))
	}
}

func TestToInt64(t *testing.T) {
	if got := toInt64(nil); got != nil {
		t.Fatalf("expected nil")
	}
	if got := toInt64(""); got != nil {
		t.Fatalf("expected nil for empty string")
	}
	if got := toInt64("abc"); got != nil {
		t.Fatalf("expected nil for non-int string")
	}
	if got := toInt64("12"); got == nil || *got != 12 {
		t.Fatalf("expected 12, got %#v", got)
	}
	if got := toInt64(float64(3)); got == nil || *got != 3 {
		t.Fatalf("expected 3, got %#v", got)
	}
	if got := toInt64(int(4)); got == nil || *got != 4 {
		t.Fatalf("expected 4, got %#v", got)
	}
	var i64 int64 = 5
	if got := toInt64(i64); got == nil || *got != 5 {
		t.Fatalf("expected 5, got %#v", got)
	}
}

func TestSanitizeText_RemovesNulAndFixesUTF8(t *testing.T) {
	// include NUL and invalid utf-8 bytes
	in := "a\x00b" + string([]byte{0xff, 0xfe})
	out := sanitizeText(in)
	if strings.Contains(out, "\x00") {
		t.Fatalf("expected NUL removed, got %q", out)
	}
	if !utf8.ValidString(out) {
		t.Fatalf("expected valid utf8, got %q", out)
	}
}
