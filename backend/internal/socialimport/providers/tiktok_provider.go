package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"golang.org/x/time/rate"
)

type TikTokProvider struct{}

func (p TikTokProvider) Name() string { return "tiktok" }

type tiktokOAuth struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	OpenID      string `json:"openId"`
	Scope       string `json:"scope"`
	ExpiresAt   string `json:"expiresAt"`
}

func (p TikTokProvider) SyncUser(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
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

	// Load token from UserSettings
	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='tiktok_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, 0, nil
	}
	var tok tiktokOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		l.Printf("[TTImport] invalid oauth json userId=%s err=%v raw=%s", userID, err, truncate(string(raw), 600))
		return 0, 0, nil
	}
	if tok.AccessToken == "" || tok.OpenID == "" {
		return 0, 0, nil
	}

	// Guard: importing video list requires the `video.list` scope.
	// Token responses may use comma or space separated scope lists.
	scopeNorm := strings.ReplaceAll(tok.Scope, " ", ",")
	if !strings.Contains(scopeNorm, "video.list") {
		l.Printf("[TTImport] skip userId=%s reason=missing_scope scope=%s", userID, tok.Scope)
		return 0, 0, nil
	}

	if limiter != nil {
		if err := limiter.Wait(ctx); err != nil {
			return 0, 0, err
		}
	}

	// TikTok API: list user videos
	req, err := http.NewRequestWithContext(ctx, "POST", "https://open.tiktokapis.com/v2/video/list/", strings.NewReader(`{"max_count":25}`))
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return 0, 0, fmt.Errorf("tiktok_non_2xx status=%d body=%s", res.StatusCode, truncate(string(body), 600))
	}

	// Shape: { data: { videos: [ { id, title, create_time, cover_image_url, share_url, view_count, like_count } ] } }
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, 0, err
	}
	data, _ := payload["data"].(map[string]any)
	videosAny, _ := data["videos"].([]any)
	fetched := len(videosAny)
	upserted := 0

	for _, vAny := range videosAny {
		v, _ := vAny.(map[string]any)
		id, _ := v["id"].(string)
		if id == "" {
			continue
		}
		title, _ := v["title"].(string)
		shareURL, _ := v["share_url"].(string)
		thumb, _ := v["cover_image_url"].(string)
		views := toInt64(v["view_count"])
		likes := toInt64(v["like_count"])

		var postedAt *time.Time
		if ct := toInt64(v["create_time"]); ct != nil && *ct > 0 {
			t := time.Unix(*ct, 0).UTC()
			postedAt = &t
		}

		rawItem, _ := json.Marshal(v)
		rowID := fmt.Sprintf("tiktok:%s:%s", userID, id)
		_, err := db.ExecContext(ctx, `
			INSERT INTO public.social_libraries
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'tiktok', 'video', NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), $7, $8, $9, $10::jsonb, $11, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  media_url = EXCLUDED.media_url,
			  thumbnail_url = EXCLUDED.thumbnail_url,
			  posted_at = EXCLUDED.posted_at,
			  views = EXCLUDED.views,
			  likes = EXCLUDED.likes,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, rowID, userID, title, shareURL, shareURL, thumb, postedAt, views, likes, string(rawItem), id)
		if err != nil {
			l.Printf("[TTImport] upsert failed userId=%s videoId=%s err=%v", userID, id, err)
			continue
		}
		upserted++
	}

	l.Printf("[TTImport] done userId=%s fetched=%d upserted=%d", userID, fetched, upserted)
	return fetched, upserted, nil
}

var _ socialimport.Provider = TikTokProvider{}
