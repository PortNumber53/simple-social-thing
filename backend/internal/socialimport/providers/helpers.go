package providers

import (
	"fmt"
	"strings"
)

func truncate(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	return s[:n]
}

func normalizeTitle(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) > 160 {
		return s[:160]
	}
	return s
}

func toInt64(v any) *int64 {
	switch t := v.(type) {
	case float64:
		i := int64(t)
		return &i
	case int64:
		return &t
	case int:
		i := int64(t)
		return &i
	case string:
		if t == "" {
			return nil
		}
		var i int64
		_, err := fmt.Sscanf(t, "%d", &i)
		if err != nil {
			return nil
		}
		return &i
	default:
		return nil
	}
}
