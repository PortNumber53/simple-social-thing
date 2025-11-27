package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"golang.org/x/time/rate"
)

type PinterestProvider struct{}

func (p PinterestProvider) Name() string { return "pinterest" }

type pinterestOAuth struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	ExpiresAt   string `json:"expiresAt"`
	Scope       string `json:"scope"`
}

func (p PinterestProvider) SyncUser(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
	if db == nil {
		return 0, 0, fmt.Errorf("db is nil")
	}
	l := logger
	if l == nil {
		l = log.Default()
	}
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}

	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT value FROM public."UserSettings" WHERE user_id=$1 AND key='pinterest_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, 0, nil
	}
	var tok pinterestOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		l.Printf("[PinterestImport] invalid oauth json userId=%s err=%v raw=%s", userID, err, truncate(string(raw), 600))
		return 0, 0, nil
	}
	if tok.AccessToken == "" {
		return 0, 0, nil
	}

	if limiter != nil {
		if err := limiter.Wait(ctx); err != nil {
			return 0, 0, err
		}
	}

	// List pins (v5). Endpoint choice: /v5/pins with page_size.
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.pinterest.com/v5/pins?page_size=25", nil)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return 0, 0, fmt.Errorf("pinterest_non_2xx status=%d body=%s", res.StatusCode, truncate(string(body), 600))
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, 0, err
	}
	itemsAny, _ := payload["items"].([]any)
	fetched := len(itemsAny)
	upserted := 0

	for _, itAny := range itemsAny {
		it, _ := itAny.(map[string]any)
		id, _ := it["id"].(string)
		if id == "" {
			continue
		}
		title, _ := it["title"].(string)
		desc, _ := it["description"].(string)
		link, _ := it["link"].(string)
		createdAt, _ := it["created_at"].(string)

		// images can be nested in media/images. Best-effort parse to find an image URL
		var thumb string
		if media, ok := it["media"].(map[string]any); ok {
			if images, ok := media["images"].(map[string]any); ok {
				// pick 400x300 if exists, else any
				if x, ok := images["400x300"].(map[string]any); ok {
					if u, ok := x["url"].(string); ok {
						thumb = u
					}
				}
				if thumb == "" {
					for _, v := range images {
						if m, ok := v.(map[string]any); ok {
							if u, ok := m["url"].(string); ok && u != "" {
								thumb = u
								break
							}
						}
					}
				}
			}
		}

		var postedAt *time.Time
		if createdAt != "" {
			if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
				tt := t.UTC()
				postedAt = &tt
			}
		}

		// Pinterest public URL isn't always in payload; use link as permalink fallback.
		permalink := link
		title2 := title
		if title2 == "" {
			title2 = desc
		}

		rawItem, _ := json.Marshal(it)
		rowID := fmt.Sprintf("pinterest:%s:%s", userID, id)
		_, err := db.ExecContext(ctx, `
			INSERT INTO public."SocialLibraries"
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'pinterest', 'pin', NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), $7, NULL, NULL, $8::jsonb, $9, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  media_url = EXCLUDED.media_url,
			  thumbnail_url = EXCLUDED.thumbnail_url,
			  posted_at = EXCLUDED.posted_at,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, rowID, userID, normalizeTitle(title2), permalink, permalink, thumb, postedAt, string(rawItem), id)
		if err != nil {
			l.Printf("[PinterestImport] upsert failed userId=%s pinId=%s err=%v", userID, id, err)
			continue
		}
		upserted++
	}

	l.Printf("[PinterestImport] done userId=%s fetched=%d upserted=%d", userID, fetched, upserted)
	return fetched, upserted, nil
}

var _ socialimport.Provider = PinterestProvider{}
