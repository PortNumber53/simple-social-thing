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
	MediaURL  string `json:"media_url"`
	ThumbURL  string `json:"thumbnail_url"`
	Timestamp string `json:"timestamp"`
	LikeCount *int64 `json:"like_count"`
	// views generally requires additional insights calls; we store likes and raw payload for now
}

// SyncUser imports the latest Instagram media for a single user and upserts rows into SocialLibraries.
// It looks up the user's stored token in public."UserSettings" key='instagram_oauth'.
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
	q := `SELECT value FROM public."UserSettings" WHERE user_id = $1 AND key = 'instagram_oauth' AND value IS NOT NULL`
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
			INSERT INTO public."SocialLibraries"
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'instagram', $3, NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), $8, NULL, $9, $10::jsonb, $11, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  content_type = EXCLUDED.content_type,
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  media_url = EXCLUDED.media_url,
			  thumbnail_url = EXCLUDED.thumbnail_url,
			  posted_at = EXCLUDED.posted_at,
			  likes = EXCLUDED.likes,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, id, userID, contentType, title, m.Permalink, mediaURL, thumbURL, postedAt, m.LikeCount, string(raw), externalID)
		if err != nil {
			l.Printf("[IGImporter] upsert failed userId=%s mediaId=%s err=%v", userID, externalID, err)
			return n, err
		}
		n++
	}
	return n, nil
}

func (i *Importer) fetchRecentMedia(ctx context.Context, igBusinessID string, accessToken string) ([]mediaItem, []byte, error) {
	u := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/media?fields=id,caption,media_type,permalink,timestamp,like_count,media_url,thumbnail_url&limit=25&access_token=%s",
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
