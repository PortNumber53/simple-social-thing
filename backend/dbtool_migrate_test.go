package backend

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type fixture struct {
	root   string
	script string
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	backendDir := filepath.Dir(file)
	return filepath.Dir(backendDir)
}

func setupFixture(t *testing.T, withMigrate bool) fixture {
	t.Helper()
	root := t.TempDir()

	deployDir := filepath.Join(root, "deploy")
	backendDir := filepath.Join(root, "backend")
	if err := os.MkdirAll(deployDir, 0o755); err != nil {
		t.Fatalf("mkdir deploy: %v", err)
	}
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend: %v", err)
	}

	src := filepath.Join(repoRoot(t), "deploy", "dbtool-migrate.sh")
	dst := filepath.Join(deployDir, "dbtool-migrate.sh")
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("read script: %v", err)
	}
	if err := os.WriteFile(dst, data, 0o755); err != nil {
		t.Fatalf("write script: %v", err)
	}

	if withMigrate {
		dbDir := filepath.Join(backendDir, "db")
		if err := os.MkdirAll(dbDir, 0o755); err != nil {
			t.Fatalf("mkdir db: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dbDir, "migrate.go"), []byte("// stub migrate"), 0o644); err != nil {
			t.Fatalf("write migrate stub: %v", err)
		}
	}

	return fixture{root: root, script: dst}
}

func writeStubGo(t *testing.T, binDir, logFile string) {
	t.Helper()
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir stub bin: %v", err)
	}
	script := `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "env" ]]; then
  if [[ "$2" == "GOARCH" ]]; then echo "native-arch"; exit 0; fi
  if [[ "$2" == "GOOS" ]]; then echo "native-os"; exit 0; fi
fi
if [[ "$1" == "run" ]]; then
  echo "RUN_GOARCH=${GOARCH:-}" >> "${DBTOOL_LOG}"
  echo "RUN_GOOS=${GOOS:-}" >> "${DBTOOL_LOG}"
  echo "ARGS=$*" >> "${DBTOOL_LOG}"
  exit 0
fi
echo "unhandled-$*" >> "${DBTOOL_LOG}"
exit 1
`
	path := filepath.Join(binDir, "go")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write stub go: %v", err)
	}
}

func runScript(t *testing.T, f fixture, env map[string]string) (int, string) {
	t.Helper()
	cmd := exec.Command("bash", f.script)
	cmd.Dir = f.root

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf

	envList := []string{}
	if pathVal, ok := env["PATH"]; ok {
		envList = append(envList, "PATH="+pathVal)
	} else {
		envList = append(envList, "PATH="+os.Getenv("PATH"))
	}
	for k, v := range env {
		if k == "PATH" {
			continue
		}
		envList = append(envList, k+"="+v)
	}
	cmd.Env = envList

	err := cmd.Run()
	out := buf.String()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode(), out
		}
		t.Fatalf("run script: %v output=%s", err, out)
	}
	return 0, out
}

func TestDbtoolMigrateRequiresDatabaseURL(t *testing.T) {
	f := setupFixture(t, true)
	status, out := runScript(t, f, map[string]string{})

	if status == 0 {
		t.Fatalf("expected failure when DATABASE_URL is missing, got status %d output=%s", status, out)
	}
	if !strings.Contains(out, "DATABASE_URL is not set") {
		t.Fatalf("expected missing DATABASE_URL message, got: %s", out)
	}
}

func TestDbtoolMigrateUsesHostArchForGoRun(t *testing.T) {
	f := setupFixture(t, true)
	logFile := filepath.Join(f.root, "go-log.txt")
	binDir := filepath.Join(f.root, "bin")
	writeStubGo(t, binDir, logFile)

	status, out := runScript(t, f, map[string]string{
		"DATABASE_URL": "postgresql://example/db",
		"GOARCH":       "arm64", // matrix override we want to ignore
		"GOOS":         "linux",
		"DBTOOL_LOG":   logFile,
		"PATH":         binDir + string(os.PathListSeparator) + os.Getenv("PATH"),
	})

	if status != 0 {
		t.Fatalf("expected success, got status %d output=%s", status, out)
	}
	data, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	log := string(data)
	if !strings.Contains(log, "RUN_GOARCH=native-arch") || !strings.Contains(log, "RUN_GOOS=native-os") {
		t.Fatalf("expected host GOARCH/GOOS, log=%s", log)
	}
	if strings.Contains(log, "RUN_GOARCH=arm64") || strings.Contains(log, "RUN_GOOS=linux") {
		t.Fatalf("go run should not inherit matrix GOARCH/GOOS, log=%s", log)
	}
	if !strings.Contains(log, "ARGS=run db/migrate.go -direction=up") {
		t.Fatalf("expected migrate invocation, log=%s", log)
	}
}

func TestDbtoolMigrateErrorsWhenMigrateFileMissing(t *testing.T) {
	f := setupFixture(t, false)
	status, out := runScript(t, f, map[string]string{
		"DATABASE_URL": "postgresql://example/db",
		"PATH":         os.Getenv("PATH"),
	})

	if status == 0 {
		t.Fatalf("expected failure without migrate.go, output=%s", out)
	}
	if !strings.Contains(out, "Migration tool not found at db/migrate.go") {
		t.Fatalf("expected missing migrate.go message, got: %s", out)
	}
}
