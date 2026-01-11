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
	Data   []mediaItem `json:"data"`
	Paging *pagingInfo `json:"paging"`
}

type pagingInfo struct {
	Cursors *cursorInfo `json:"cursors"`
	Next    string      `json:"next"`
}

type cursorInfo struct {
	Before string `json:"before"`
	After  string `json:"after"`
}

type mediaItem struct {
	ID        string `json:"id"`
	Caption   string `json:"caption"`
	MediaType string `json:"media_type"`
	Permalink string `json:"permalink"`
	MediaURL  string `json:"media_url"`
	ThumbURL  string `json:"thumbnail_url"`
	Timestamp string `json:"timestamp"`
	LikeCount *int64 `json:"like_count"`
	ViewCount *int64 `json:"views,omitempty"`
	// views fetched from insights endpoint
}

type insightsResponse struct {
	Data []insightMetric `json:"data"`
}

type insightMetric struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}

// SyncUser imports the latest Instagram media for a single user and upserts rows into SocialLibraries.
// It looks up the user's stored token in public.user_settings key='instagram_oauth'.
func SyncUser(ctx context.Context, db *sql.DB, userID string, logger *log.Logger) (fetched int, upserted int, err error) {
	return syncUserWithClient(ctx, db, userID, logger, &http.Client{Timeout: 15 * time.Second})
}

func syncUserWithClient(ctx context.Context, db *sql.DB, userID string, logger *log.Logger, client *http.Client) (fetched int, upserted int, err error) {
	if db == nil {
		return 0, 0, fmt.Errorf("db is nil")
	}
	l := logger
	if l == nil {
		l = log.Default()
	}
	if userID == "" {
		return 0, 0, fmt.Errorf("userID is required")
	}

	var raw []byte
	q := `SELECT value FROM public.user_settings WHERE user_id = $1 AND key = 'instagram_oauth' AND value IS NOT NULL`
	if err := db.QueryRowContext(ctx, q, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, 0, nil
	}
	var tok oauthRecord
	if err := json.Unmarshal(raw, &tok); err != nil {
		l.Printf("[IGSync] invalid oauth json userId=%s err=%v raw=%s", userID, err, truncate(string(raw), 600))
		return 0, 0, nil
	}
	if tok.AccessToken == "" || tok.IGBusinessID == "" {
		l.Printf("[IGSync] missing token fields userId=%s accessToken=%t igBusinessId=%t", userID, tok.AccessToken != "", tok.IGBusinessID != "")
		return 0, 0, nil
	}

	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	imp := &Importer{DB: db, Client: client}
	media, _, err := imp.fetchRecentMedia(ctx, tok.IGBusinessID, tok.AccessToken)
	if err != nil {
		return 0, 0, err
	}
	fetched = len(media)
	if fetched == 0 {
		return fetched, 0, nil
	}

	// Reuse the existing upsert logic; it logs upsert errors and counts successes.
	upserted, err = imp.importForUser(ctx, userID, tok, l)
	return fetched, upserted, err
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
	i.logSchemaInfo(ctx, l)
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
	l.Printf("[IGImporter] tokens found=%d", len(records))
	if len(records) == 0 {
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
		l.Printf("[IGImporter] importing userId=%s igBusinessId=%s expiresAt=%s", rec.UserID, rec.Token.IGBusinessID, rec.Token.ExpiresAt)
		n, err := i.importForUser(ctx, rec.UserID, rec.Token, l)
		if err != nil {
			l.Printf("[IGImporter] import error userId=%s err=%v", rec.UserID, err)
			continue
		}
		usersOK++
		totalItems += n
		l.Printf("[IGImporter] imported userId=%s items=%d", rec.UserID, n)
	}

	l.Printf("[IGImporter] done users=%d items=%d dur=%s", usersOK, totalItems, time.Since(start))
}

type tokenRow struct {
	UserID string
	Token  oauthRecord
}

func (i *Importer) loadTokens(ctx context.Context) ([]tokenRow, error) {
	// We store instagram tokens in user_settings key="instagram_oauth" as JSONB.
	rows, err := i.DB.QueryContext(ctx, `
		SELECT user_id, value
		FROM public.user_settings
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
			log.Printf("[IGImporter] invalid oauth json userId=%s err=%v raw=%s", userID, err, truncate(string(raw), 600))
			continue
		}
		if tok.AccessToken == "" || tok.IGBusinessID == "" {
			log.Printf("[IGImporter] skip userId=%s reason=missing_token_fields accessToken=%t igBusinessId=%t", userID, tok.AccessToken != "", tok.IGBusinessID != "")
			continue
		}
		out = append(out, tokenRow{UserID: userID, Token: tok})
	}
	return out, nil
}

func (i *Importer) importForUser(ctx context.Context, userID string, tok oauthRecord, l *log.Logger) (int, error) {
	media, rawPayload, err := i.fetchRecentMedia(ctx, tok.IGBusinessID, tok.AccessToken)
	if err != nil {
		return 0, err
	}
	if len(media) == 0 {
		l.Printf("[IGImporter] no media userId=%s", userID)
		return 0, nil
	}
	l.Printf("[IGImporter] media fetched userId=%s count=%d", userID, len(media))

	// Fetch insights (views) for each media item
	// Note: This requires instagram_business_content_access permission on the app
	// If permission is not available, skip insights fetching entirely
	insightsAvailable := true
	for idx := range media {
		if !insightsAvailable {
			break
		}
		views, err := i.fetchMediaInsights(ctx, media[idx].ID, tok.AccessToken)
		if err != nil {
			// If we get a permission error, skip insights for all remaining items
			if strings.Contains(err.Error(), "does not have permission") {
				l.Printf("[IGImporter] insights permission not available userId=%s (instagram_business_content_access may need to be requested in app review)", userID)
				insightsAvailable = false
				break
			}
			// For other errors, log but continue
			l.Printf("[IGImporter] insights fetch failed mediaId=%s err=%v", media[idx].ID, err)
		} else if views > 0 {
			media[idx].ViewCount = &views
		}
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
		mediaURL := strings.TrimSpace(m.MediaURL)
		thumbURL := strings.TrimSpace(m.ThumbURL)
		if thumbURL == "" {
			thumbURL = mediaURL
		}

		// For raw payload, store the individual media item if possible; otherwise store whole list payload for debug.
		raw := rawPayload
		if b, err := json.Marshal(m); err == nil {
			raw = b
		}

		id := fmt.Sprintf("instagram:%s:%s", userID, externalID)
		_, err := i.DB.ExecContext(ctx, `
			INSERT INTO public.social_libraries
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'instagram', $3, NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), $8, $9, $10, $11::jsonb, $12, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  content_type = EXCLUDED.content_type,
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  media_url = EXCLUDED.media_url,
			  thumbnail_url = EXCLUDED.thumbnail_url,
			  posted_at = EXCLUDED.posted_at,
			  views = EXCLUDED.views,
			  likes = EXCLUDED.likes,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, id, userID, contentType, title, m.Permalink, mediaURL, thumbURL, postedAt, m.ViewCount, m.LikeCount, string(raw), externalID)
		if err != nil {
			l.Printf("[IGImporter] upsert failed userId=%s mediaId=%s err=%v", userID, externalID, err)
			return n, err
		}
		n++
	}
	return n, nil
}

func (i *Importer) fetchRecentMedia(ctx context.Context, igBusinessID string, accessToken string) ([]mediaItem, []byte, error) {
	allMedia := make([]mediaItem, 0)
	var lastBody []byte
	after := ""
	maxPages := 100 // Safety limit to prevent infinite loops

	for page := 0; page < maxPages; page++ {
		select {
		case <-ctx.Done():
			return allMedia, lastBody, ctx.Err()
		default:
		}

		u := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/media?fields=id,caption,media_type,permalink,timestamp,like_count,media_url,thumbnail_url&limit=100",
			igBusinessID,
		)
		if after != "" {
			u += "&after=" + after
		}
		u += "&access_token=" + accessToken

		req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
		if err != nil {
			return allMedia, lastBody, err
		}
		req.Header.Set("Accept", "application/json")

		res, err := i.Client.Do(req)
		if err != nil {
			return allMedia, lastBody, err
		}
		defer res.Body.Close()

		body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		lastBody = body
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return allMedia, body, fmt.Errorf("graph_non_2xx status=%d body=%s", res.StatusCode, truncate(string(body), 600))
		}

		var parsed mediaListResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return allMedia, body, err
		}

		allMedia = append(allMedia, parsed.Data...)

		// Check if there are more pages
		if parsed.Paging == nil || parsed.Paging.Cursors == nil || parsed.Paging.Cursors.After == "" {
			break
		}
		after = parsed.Paging.Cursors.After
	}

	return allMedia, lastBody, nil
}

// fetchMediaInsights retrieves view count for a single media item from Instagram insights API.
func (i *Importer) fetchMediaInsights(ctx context.Context, mediaID string, accessToken string) (int64, error) {
	// Instagram insights for media require the insights metric (views, impressions, etc.)
	// For reels: plays is the primary metric
	// For posts: impressions is the primary metric
	// Note: insights endpoint requires instagram_business_content_access permission
	u := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/insights?metric=impressions,plays&access_token=%s",
		mediaID,
		accessToken,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := i.Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// Log the error response body for debugging
		errMsg := truncate(string(body), 300)
		return 0, fmt.Errorf("insights_non_2xx status=%d body=%s", res.StatusCode, errMsg)
	}

	var parsed insightsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, err
	}

	// Find the first available metric (plays for reels, impressions for posts)
	for _, metric := range parsed.Data {
		if metric.Name == "plays" || metric.Name == "impressions" {
			return metric.Value, nil
		}
	}
	return 0, nil
}

func (i *Importer) logSchemaInfo(ctx context.Context, l *log.Logger) {
	// Best-effort: confirm the unique constraint exists so ON CONFLICT works.
	var exists bool
	err := i.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
		  SELECT 1
		  FROM pg_constraint
		  WHERE conname = 'uq_social_libraries_user_network_external'
		)
	`).Scan(&exists)
	if err != nil {
		l.Printf("[IGImporter] schema check failed err=%v", err)
		return
	}
	l.Printf("[IGImporter] schema uq_social_libraries_user_network_external=%t", exists)
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
	// IG returns RFC3339-ish timestamps, but in practice we can see:
	// - 2024-01-02T03:04:05Z
	// - 2024-01-02T03:04:05+00:00
	// - 2024-01-02T03:04:05+0000   (no colon in offset)
	// - fractional seconds variants of the above
	ts = strings.TrimSpace(ts)
	if ts == "" {
		return nil
	}

	// Try the standard formats first.
	if t, err := time.Parse(time.RFC3339Nano, ts); err == nil {
		tt := t.UTC()
		return &tt
	}

	// Try offset-without-colon formats.
	for _, layout := range []string{
		"2006-01-02T15:04:05-0700",
		"2006-01-02T15:04:05.999999999-0700",
	} {
		if t, err := time.Parse(layout, ts); err == nil {
			tt := t.UTC()
			return &tt
		}
	}

	return nil
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
