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
	"strings"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"golang.org/x/time/rate"
)

type FacebookProvider struct{}

func (p FacebookProvider) Name() string { return "facebook" }

type facebookOAuth struct {
	AccessToken string `json:"accessToken"`
	PageID      string `json:"pageId"`
	PageName    string `json:"pageName"`
	ExpiresAt   string `json:"expiresAt"`
}

type fbPostsResp struct {
	Data []fbPost `json:"data"`
}

type fbPost struct {
	ID          string `json:"id"`
	Message     string `json:"message"`
	CreatedTime string `json:"created_time"`
	Permalink   string `json:"permalink_url"`
	Attachments struct {
		Data []struct {
			Type  string `json:"type"`
			URL   string `json:"url"`
			Media struct {
				Image struct {
					Src string `json:"src"`
				} `json:"image"`
			} `json:"media"`
		} `json:"data"`
	} `json:"attachments"`
}

func (p FacebookProvider) SyncUser(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
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
	if err := db.QueryRowContext(ctx, `SELECT value FROM public."UserSettings" WHERE user_id=$1 AND key='facebook_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, 0, nil
	}
	var tok facebookOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		l.Printf("[FBImport] invalid oauth json userId=%s err=%v raw=%s", userID, err, truncate(string(raw), 600))
		return 0, 0, nil
	}
	if tok.AccessToken == "" || tok.PageID == "" {
		return 0, 0, nil
	}

	if limiter != nil {
		if err := limiter.Wait(ctx); err != nil {
			return 0, 0, err
		}
	}

	// Basic: import latest page posts. For richer metrics, we can add insights calls later.
	endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/posts", url.PathEscape(tok.PageID))
	q := url.Values{}
	q.Set("fields", "id,message,created_time,permalink_url,attachments{type,url,media}")
	q.Set("limit", "25")
	q.Set("access_token", tok.AccessToken)
	reqURL := endpoint + "?" + q.Encode()

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
		return 0, 0, fmt.Errorf("facebook_non_2xx status=%d body=%s", res.StatusCode, truncate(string(body), 600))
	}

	var parsed fbPostsResp
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, 0, err
	}
	fetched := len(parsed.Data)
	upserted := 0

	for _, post := range parsed.Data {
		if post.ID == "" {
			continue
		}
		title := normalizeTitle(post.Message)
		permalink := strings.TrimSpace(post.Permalink)
		var thumb string
		var mediaURL string
		if len(post.Attachments.Data) > 0 {
			a := post.Attachments.Data[0]
			mediaURL = strings.TrimSpace(a.URL)
			thumb = strings.TrimSpace(a.Media.Image.Src)
			if thumb == "" {
				thumb = mediaURL
			}
		}

		var postedAt *time.Time
		if post.CreatedTime != "" {
			if t, err := time.Parse(time.RFC3339, post.CreatedTime); err == nil {
				tt := t.UTC()
				postedAt = &tt
			}
		}

		rawItem, _ := json.Marshal(post)
		rowID := fmt.Sprintf("facebook:%s:%s", userID, post.ID)
		_, err := db.ExecContext(ctx, `
			INSERT INTO public."SocialLibraries"
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'facebook', 'post', NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), $7, NULL, NULL, $8::jsonb, $9, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  media_url = EXCLUDED.media_url,
			  thumbnail_url = EXCLUDED.thumbnail_url,
			  posted_at = EXCLUDED.posted_at,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, rowID, userID, title, permalink, mediaURL, thumb, postedAt, string(rawItem), post.ID)
		if err != nil {
			l.Printf("[FBImport] upsert failed userId=%s postId=%s err=%v", userID, post.ID, err)
			continue
		}
		upserted++
	}

	l.Printf("[FBImport] done userId=%s pageId=%s fetched=%d upserted=%d", userID, tok.PageID, fetched, upserted)
	return fetched, upserted, nil
}

var _ socialimport.Provider = FacebookProvider{}
