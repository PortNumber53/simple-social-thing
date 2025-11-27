package instagram

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
)

type Importer struct {
	DB       *sql.DB
	Client   *http.Client
	Interval time.Duration
	Logger   *log.Logger
}

type oauthRecord struct {
	AccessToken        string `json:"accessToken"`
	TokenType          string `json:"tokenType"`
	ExpiresIn          int64  `json:"expiresIn"`
	ObtainedAt         string `json:"obtainedAt"`
	ExpiresAt          string `json:"expiresAt"`
	PageID             string `json:"pageId"`
	IGBusinessID       string `json:"igBusinessId"`
	Username           string `json:"username"`
	ProviderAPIVersion string `json:"providerApiVersion"`
}

type mediaListResponse struct {
	Data []mediaItem `json:"data"`
}

type mediaItem struct {
	ID        string `json:"id"`
	Caption   string `json:"caption"`
	MediaType string `json:"media_type"`
	Permalink string `json:"permalink"`
	Timestamp string `json:"timestamp"`
	LikeCount *int64 `json:"like_count"`
	// views generally requires additional insights calls; we store likes and raw payload for now
}

// Start runs forever until ctx is cancelled.
func (i *Importer) Start(ctx context.Context) {
	if i.DB == nil {
		return
	}
	if i.Client == nil {
		i.Client = &http.Client{Timeout: 15 * time.Second}
	}
	if i.Interval <= 0 {
		i.Interval = 15 * time.Minute
	}
	l := i.Logger
	if l == nil {
		l = log.Default()
	}

	ticker := time.NewTicker(i.Interval)
	defer ticker.Stop()

	l.Printf("[IGImporter] started interval=%s", i.Interval.String())
	// run immediately once
	i.runOnce(ctx, l)

	for {
		select {
		case <-ctx.Done():
			l.Printf("[IGImporter] stopped: %v", ctx.Err())
			return
		case <-ticker.C:
			i.runOnce(ctx, l)
		}
	}
}

func (i *Importer) runOnce(ctx context.Context, l *log.Logger) {
	start := time.Now()
	records, err := i.loadTokens(ctx)
	if err != nil {
		l.Printf("[IGImporter] loadTokens error: %v", err)
		return
	}
	if len(records) == 0 {
		l.Printf("[IGImporter] no instagram_oauth tokens found")
		return
	}

	var totalItems int
	var usersOK int
	for _, rec := range records {
		select {
		case <-ctx.Done():
			return
		default:
		}
		n, err := i.importForUser(ctx, rec.UserID, rec.Token)
		if err != nil {
			l.Printf("[IGImporter] import error userId=%s err=%v", rec.UserID, err)
			continue
		}
		usersOK++
		totalItems += n
	}

	l.Printf("[IGImporter] done users=%d items=%d dur=%s", usersOK, totalItems, time.Since(start))
}

type tokenRow struct {
	UserID string
	Token  oauthRecord
}

func (i *Importer) loadTokens(ctx context.Context) ([]tokenRow, error) {
	// We store instagram tokens in UserSettings key="instagram_oauth" as JSONB.
	rows, err := i.DB.QueryContext(ctx, `
		SELECT user_id, value
		FROM public."UserSettings"
		WHERE key = 'instagram_oauth' AND value IS NOT NULL
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]tokenRow, 0)
	for rows.Next() {
		var userID string
		var raw []byte
		if err := rows.Scan(&userID, &raw); err != nil {
			return nil, err
		}
		if len(raw) == 0 || string(raw) == "null" {
			continue
		}
		var tok oauthRecord
		if err := json.Unmarshal(raw, &tok); err != nil {
			// Older/unexpected shapes: ignore but log
			log.Printf("[IGImporter] invalid oauth json userId=%s err=%v raw=%s", userID, err, string(raw))
			continue
		}
		if tok.AccessToken == "" || tok.IGBusinessID == "" {
			continue
		}
		out = append(out, tokenRow{UserID: userID, Token: tok})
	}
	return out, nil
}

func (i *Importer) importForUser(ctx context.Context, userID string, tok oauthRecord) (int, error) {
	media, rawPayload, err := i.fetchRecentMedia(ctx, tok.IGBusinessID, tok.AccessToken)
	if err != nil {
		return 0, err
	}
	if len(media) == 0 {
		return 0, nil
	}

	n := 0
	for _, m := range media {
		select {
		case <-ctx.Done():
			return n, ctx.Err()
		default:
		}
		if m.ID == "" {
			continue
		}
		title := normalizeTitle(m.Caption)
		contentType := mapMediaType(m.MediaType)
		postedAt := parseIGTimestamp(m.Timestamp)
		externalID := m.ID

		// For raw payload, store the individual media item if possible; otherwise store whole list payload for debug.
		raw := rawPayload
		if b, err := json.Marshal(m); err == nil {
			raw = b
		}

		id := fmt.Sprintf("instagram:%s:%s", userID, externalID)
		_, err := i.DB.ExecContext(ctx, `
			INSERT INTO public."SocialLibraries"
			  (id, user_id, network, content_type, title, permalink_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'instagram', $3, NULLIF($4,''), NULLIF($5,''), $6, NULL, $7, $8::jsonb, $9, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  content_type = EXCLUDED.content_type,
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  posted_at = EXCLUDED.posted_at,
			  likes = EXCLUDED.likes,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, id, userID, contentType, title, m.Permalink, postedAt, m.LikeCount, string(raw), externalID)
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func (i *Importer) fetchRecentMedia(ctx context.Context, igBusinessID string, accessToken string) ([]mediaItem, []byte, error) {
	u := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/media?fields=id,caption,media_type,permalink,timestamp,like_count&limit=25&access_token=%s",
		igBusinessID,
		accessToken,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := i.Client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, body, fmt.Errorf("graph_non_2xx status=%d body=%s", res.StatusCode, truncate(string(body), 600))
	}

	var parsed mediaListResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, body, err
	}
	return parsed.Data, body, nil
}

func mapMediaType(mt string) string {
	mt = strings.ToUpper(strings.TrimSpace(mt))
	switch mt {
	case "IMAGE", "CAROUSEL_ALBUM":
		return "post"
	case "VIDEO":
		return "video"
	default:
		return strings.ToLower(mt)
	}
}

func parseIGTimestamp(ts string) *time.Time {
	if ts == "" {
		return nil
	}
	// IG returns RFC3339-ish timestamps
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return nil
	}
	return &t
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

func truncate(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	return s[:n]
}
