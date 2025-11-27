package providers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"golang.org/x/time/rate"
)

// ThreadsProvider imports Threads posts for a user.
//
// NOTE: Threads API details can vary by app configuration/approval. This implementation is best-effort
// and will log provider errors to help us adjust fields/endpoints as needed.
type ThreadsProvider struct{}

func (p ThreadsProvider) Name() string { return "threads" }

type threadsOAuth struct {
	AccessToken   string `json:"accessToken"`
	TokenType     string `json:"tokenType"`
	ThreadsUserID string `json:"threadsUserId"`
	ExpiresAt     string `json:"expiresAt"`
	Scope         string `json:"scope"`
}

func (p ThreadsProvider) SyncUser(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
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
	if err := db.QueryRowContext(ctx, `SELECT value FROM public."UserSettings" WHERE user_id=$1 AND key='threads_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, 0, nil
	}
	var tok threadsOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		l.Printf("[ThreadsImport] invalid oauth json userId=%s err=%v raw=%s", userID, err, truncate(string(raw), 600))
		return 0, 0, nil
	}
	if tok.AccessToken == "" || tok.ThreadsUserID == "" {
		return 0, 0, nil
	}

	if limiter != nil {
		if err := limiter.Wait(ctx); err != nil {
			return 0, 0, err
		}
	}

	// Best-effort Graph call. Fields may vary; adjust later based on API responses.
	base := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/threads", url.PathEscape(tok.ThreadsUserID))
	q := url.Values{}
	q.Set("fields", "id,text,permalink,timestamp,media_type,media_url,thumbnail_url,like_count,reply_count,repost_count")
	q.Set("limit", "25")
	q.Set("access_token", tok.AccessToken)
	reqURL := base + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return 0, 0, fmt.Errorf("threads_non_2xx status=%d body=%s", res.StatusCode, truncate(string(body), 600))
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, 0, err
	}
	dataAny, _ := payload["data"].([]any)
	fetched := len(dataAny)
	upserted := 0

	for _, itAny := range dataAny {
		it, _ := itAny.(map[string]any)
		id, _ := it["id"].(string)
		if id == "" {
			continue
		}
		text, _ := it["text"].(string)
		permalink, _ := it["permalink"].(string)
		ts, _ := it["timestamp"].(string)
		mediaURL, _ := it["media_url"].(string)
		thumb, _ := it["thumbnail_url"].(string)
		likes := toInt64(it["like_count"])

		var postedAt *time.Time
		if ts != "" {
			if t, err := time.Parse(time.RFC3339, ts); err == nil {
				tt := t.UTC()
				postedAt = &tt
			}
		}

		rawItem, _ := json.Marshal(it)
		rowID := fmt.Sprintf("threads:%s:%s", userID, id)
		_, err := db.ExecContext(ctx, `
			INSERT INTO public."SocialLibraries"
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'threads', 'post', NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), $7, NULL, $8, $9::jsonb, $10, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  media_url = EXCLUDED.media_url,
			  thumbnail_url = EXCLUDED.thumbnail_url,
			  posted_at = EXCLUDED.posted_at,
			  likes = EXCLUDED.likes,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, rowID, userID, normalizeTitle(text), permalink, mediaURL, thumb, postedAt, likes, string(rawItem), id)
		if err != nil {
			l.Printf("[ThreadsImport] upsert failed userId=%s threadId=%s err=%v", userID, id, err)
			continue
		}
		upserted++
	}

	l.Printf("[ThreadsImport] done userId=%s fetched=%d upserted=%d", userID, fetched, upserted)
	return fetched, upserted, nil
}

var _ socialimport.Provider = ThreadsProvider{}
