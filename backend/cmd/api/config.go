package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

// loadEnvironment loads configuration from layered sources in increasing priority:
//  1. /etc/simple/config.ini        (system defaults)
//  2. ~/.config/simple/config.ini   (user overrides)
//  3. .env                          (project-local overrides)
//
// Environment variables already present in the process environment always win.
func loadEnvironment() error {
	shellEnv := envMap(os.Environ())

	// Lowest priority: system-wide INI file.
	values := map[string]string{}
	applyINI(values, "/etc/simple/config.ini")

	// Middle priority: user INI file.
	if home, err := os.UserHomeDir(); err == nil {
		applyINI(values, filepath.Join(home, ".config", "simple", "config.ini"))
	}

	// Higher priority: project-local .env file.
	applyDotEnv(values, ".env")

	// Apply merged values, but never override shell env vars.
	for k, v := range values {
		if _, setByShell := shellEnv[k]; !setByShell {
			if err := os.Setenv(k, v); err != nil {
				return fmt.Errorf("set env %s: %w", k, err)
			}
		}
	}

	return nil
}

// envMap converts a slice of KEY=VALUE strings into a map.
func envMap(environ []string) map[string]string {
	m := make(map[string]string, len(environ))
	for _, e := range environ {
		if k, v, ok := strings.Cut(e, "="); ok {
			m[k] = v
		}
	}
	return m
}

// applyINI parses an INI file at path and merges its key=value pairs into dst.
// Missing files are ignored. Values are loaded from all sections; later sections
// override earlier ones, and later calls to applyINI override earlier calls.
func applyINI(dst map[string]string, path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			continue
		}
		if key, value, ok := strings.Cut(line, "="); ok {
			dst[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	_ = scanner.Err() // best-effort: ignore malformed lines rather than failing startup
}

// applyDotEnv parses a .env file at path and merges its key=value pairs into dst.
// Missing files are ignored.
func applyDotEnv(dst map[string]string, path string) {
	m, err := godotenv.Read(path)
	if err != nil {
		return
	}
	for k, v := range m {
		dst[k] = v
	}
}
