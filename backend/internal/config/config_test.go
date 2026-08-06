package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvironment_LayeredPrecedence(t *testing.T) {
	// Create temporary config and .env files.
	tmp := t.TempDir()
	etcINI := filepath.Join(tmp, "etc.ini")
	userINI := filepath.Join(tmp, "user.ini")
	dotEnv := filepath.Join(tmp, ".env")

	if err := os.WriteFile(etcINI, []byte("SOURCE=etc\nSHARED=from_etc\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(userINI, []byte("SOURCE=user\nSHARED=from_user\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dotEnv, []byte("SOURCE=dotenv\nSHARED=from_dotenv\n"), 0644); err != nil {
		t.Fatal(err)
	}

	shellEnv := map[string]string{}
	if v := os.Getenv("SOURCE"); v != "" {
		shellEnv["SOURCE"] = v
	}
	if v := os.Getenv("SHARED"); v != "" {
		shellEnv["SHARED"] = v
	}
	if v := os.Getenv("OTHER"); v != "" {
		shellEnv["OTHER"] = v
	}
	t.Cleanup(func() {
		for k, v := range shellEnv {
			os.Setenv(k, v)
		}
		os.Unsetenv("SOURCE")
		os.Unsetenv("SHARED")
		os.Unsetenv("OTHER")
	})
	os.Unsetenv("SOURCE")
	os.Unsetenv("SHARED")
	os.Unsetenv("OTHER")

	values := map[string]string{}
	applyINI(values, etcINI)
	applyINI(values, userINI)
	applyDotEnv(values, dotEnv)

	if got := values["SOURCE"]; got != "dotenv" {
		t.Fatalf("expected SOURCE=dotenv, got %q", got)
	}
	if got := values["SHARED"]; got != "from_dotenv" {
		t.Fatalf("expected SHARED=from_dotenv, got %q", got)
	}
}

func TestApplyINI_ParsesSectionsAndComments(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "config.ini")
	content := `
# top comment
[DEFAULT]
KEY_ONE=value one
; section comment
[app]
KEY_TWO = value two
ignored line without equals
`
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	values := map[string]string{}
	applyINI(values, path)

	if got := values["KEY_ONE"]; got != "value one" {
		t.Fatalf("expected KEY_ONE=%q, got %q", "value one", got)
	}
	if got := values["KEY_TWO"]; got != "value two" {
		t.Fatalf("expected KEY_TWO=%q, got %q", "value two", got)
	}
	if _, ok := values["ignored line without equals"]; ok {
		t.Fatal("expected lines without = to be ignored")
	}
}
