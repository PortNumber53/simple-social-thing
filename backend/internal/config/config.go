package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

// Load loads configuration from layered sources in increasing priority:
//  1. /etc/simple-social-thing/config.ini        (system defaults)
//  2. ~/.config/simple/config.ini   (user overrides)
//  3. .env                          (project-local overrides)
//
// Environment variables already present in the process environment always win.
func Load() error {
	shellEnv := envMap(os.Environ())

	values := map[string]string{}
	applyINI(values, "/etc/simple-social-thing/config.ini")

	if home, err := os.UserHomeDir(); err == nil {
		applyINI(values, filepath.Join(home, ".config", "simple-social-thing", "config.ini"))
	}

	applyDotEnv(values, ".env")

	for k, v := range values {
		if _, setByShell := shellEnv[k]; !setByShell {
			if err := os.Setenv(k, v); err != nil {
				return fmt.Errorf("set env %s: %w", k, err)
			}
		}
	}

	return nil
}

func envMap(environ []string) map[string]string {
	m := make(map[string]string, len(environ))
	for _, e := range environ {
		if k, v, ok := strings.Cut(e, "="); ok {
			m[k] = v
		}
	}
	return m
}

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
	_ = scanner.Err()
}

func applyDotEnv(dst map[string]string, path string) {
	m, err := godotenv.Read(path)
	if err != nil {
		return
	}
	for k, v := range m {
		dst[k] = v
	}
}
