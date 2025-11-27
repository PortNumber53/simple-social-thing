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

type YouTubeProvider struct{}

func (p YouTubeProvider) Name() string { return "youtube" }

type youtubeOAuth struct {
	AccessToken  string `json:"accessToken"`
	TokenType    string `json:"tokenType"`
	ExpiresAt    string `json:"expiresAt"`
	RefreshToken string `json:"refreshToken"`
	Scope        string `json:"scope"`
}

func (p YouTubeProvider) SyncUser(ctx context.Context, db *sql.DB, userID string, client *http.Client, limiter *rate.Limiter, logger *log.Logger) (int, int, error) {
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

	// Load token
	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT value FROM public."UserSettings" WHERE user_id=$1 AND key='youtube_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, nil
		}
		return 0, 0, err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, 0, nil
	}
	var tok youtubeOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		l.Printf("[YTImport] invalid oauth json userId=%s err=%v raw=%s", userID, err, truncate(string(raw), 600))
		return 0, 0, nil
	}
	if tok.AccessToken == "" {
		return 0, 0, nil
	}

	wait := func() error {
		if limiter == nil {
			return nil
		}
		return limiter.Wait(ctx)
	}

	// 1) Get channel (mine=true)
	if err := wait(); err != nil {
		return 0, 0, err
	}
	chURL := "https://www.googleapis.com/youtube/v3/channels"
	chQ := url.Values{}
	chQ.Set("part", "snippet,contentDetails")
	chQ.Set("mine", "true")
	chReq, _ := http.NewRequestWithContext(ctx, "GET", chURL+"?"+chQ.Encode(), nil)
	chReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	chReq.Header.Set("Accept", "application/json")
	chRes, err := client.Do(chReq)
	if err != nil {
		return 0, 0, err
	}
	chBody, _ := io.ReadAll(io.LimitReader(chRes.Body, 1<<20))
	_ = chRes.Body.Close()
	if chRes.StatusCode < 200 || chRes.StatusCode >= 300 {
		return 0, 0, fmt.Errorf("youtube_channels_non_2xx status=%d body=%s", chRes.StatusCode, truncate(string(chBody), 600))
	}

	var chParsed map[string]any
	if err := json.Unmarshal(chBody, &chParsed); err != nil {
		return 0, 0, err
	}
	itemsAny, _ := chParsed["items"].([]any)
	if len(itemsAny) == 0 {
		return 0, 0, nil
	}
	first, _ := itemsAny[0].(map[string]any)
	channelID, _ := first["id"].(string)
	snippet, _ := first["snippet"].(map[string]any)
	channelTitle, _ := snippet["title"].(string)
	contentDetails, _ := first["contentDetails"].(map[string]any)
	related, _ := contentDetails["relatedPlaylists"].(map[string]any)
	uploadsID, _ := related["uploads"].(string)

	if uploadsID == "" {
		return 0, 0, nil
	}

	// 2) List playlist items (uploads)
	if err := wait(); err != nil {
		return 0, 0, err
	}
	plURL := "https://www.googleapis.com/youtube/v3/playlistItems"
	plQ := url.Values{}
	plQ.Set("part", "contentDetails,snippet")
	plQ.Set("playlistId", uploadsID)
	plQ.Set("maxResults", "25")
	plReq, _ := http.NewRequestWithContext(ctx, "GET", plURL+"?"+plQ.Encode(), nil)
	plReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	plReq.Header.Set("Accept", "application/json")
	plRes, err := client.Do(plReq)
	if err != nil {
		return 0, 0, err
	}
	plBody, _ := io.ReadAll(io.LimitReader(plRes.Body, 1<<20))
	_ = plRes.Body.Close()
	if plRes.StatusCode < 200 || plRes.StatusCode >= 300 {
		return 0, 0, fmt.Errorf("youtube_playlistitems_non_2xx status=%d body=%s", plRes.StatusCode, truncate(string(plBody), 600))
	}
	var plParsed map[string]any
	if err := json.Unmarshal(plBody, &plParsed); err != nil {
		return 0, 0, err
	}
	plItemsAny, _ := plParsed["items"].([]any)
	if len(plItemsAny) == 0 {
		return 0, 0, nil
	}

	videoIDs := make([]string, 0, len(plItemsAny))
	for _, itAny := range plItemsAny {
		it, _ := itAny.(map[string]any)
		cd, _ := it["contentDetails"].(map[string]any)
		vid, _ := cd["videoId"].(string)
		if vid != "" {
			videoIDs = append(videoIDs, vid)
		}
	}
	if len(videoIDs) == 0 {
		return 0, 0, nil
	}

	// 3) Fetch video details (statistics)
	if err := wait(); err != nil {
		return 0, 0, err
	}
	vidURL := "https://www.googleapis.com/youtube/v3/videos"
	vidQ := url.Values{}
	vidQ.Set("part", "snippet,statistics")
	vidQ.Set("id", joinComma(videoIDs))
	vidReq, _ := http.NewRequestWithContext(ctx, "GET", vidURL+"?"+vidQ.Encode(), nil)
	vidReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	vidReq.Header.Set("Accept", "application/json")
	vidRes, err := client.Do(vidReq)
	if err != nil {
		return 0, 0, err
	}
	vidBody, _ := io.ReadAll(io.LimitReader(vidRes.Body, 1<<20))
	_ = vidRes.Body.Close()
	if vidRes.StatusCode < 200 || vidRes.StatusCode >= 300 {
		return 0, 0, fmt.Errorf("youtube_videos_non_2xx status=%d body=%s", vidRes.StatusCode, truncate(string(vidBody), 600))
	}
	var vidParsed map[string]any
	if err := json.Unmarshal(vidBody, &vidParsed); err != nil {
		return 0, 0, err
	}
	vidItemsAny, _ := vidParsed["items"].([]any)

	fetched := len(vidItemsAny)
	upserted := 0

	for _, vAny := range vidItemsAny {
		v, _ := vAny.(map[string]any)
		vid, _ := v["id"].(string)
		if vid == "" {
			continue
		}
		sn, _ := v["snippet"].(map[string]any)
		title, _ := sn["title"].(string)
		publishedAt, _ := sn["publishedAt"].(string)
		thumbnails, _ := sn["thumbnails"].(map[string]any)
		var thumb string
		if thumbnails != nil {
			if hi, ok := thumbnails["high"].(map[string]any); ok {
				if u, ok := hi["url"].(string); ok {
					thumb = u
				}
			}
			if thumb == "" {
				if def, ok := thumbnails["default"].(map[string]any); ok {
					if u, ok := def["url"].(string); ok {
						thumb = u
					}
				}
			}
		}
		stats, _ := v["statistics"].(map[string]any)
		viewCount := toInt64(stats["viewCount"])
		likeCount := toInt64(stats["likeCount"])

		var postedAt *time.Time
		if publishedAt != "" {
			if t, err := time.Parse(time.RFC3339, publishedAt); err == nil {
				tt := t.UTC()
				postedAt = &tt
			}
		}

		permalink := fmt.Sprintf("https://www.youtube.com/watch?v=%s", vid)
		rawItem, _ := json.Marshal(v)
		rowID := fmt.Sprintf("youtube:%s:%s", userID, vid)
		_, err := db.ExecContext(ctx, `
			INSERT INTO public."SocialLibraries"
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'youtube', 'video', NULLIF($3,''), $4, $5, NULLIF($6,''), $7, $8, $9, $10::jsonb, $11, NOW(), NOW())
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
		`, rowID, userID, normalizeTitle(title), permalink, permalink, thumb, postedAt, viewCount, likeCount, string(rawItem), vid)
		if err != nil {
			l.Printf("[YTImport] upsert failed userId=%s videoId=%s err=%v", userID, vid, err)
			continue
		}
		upserted++
	}

	l.Printf("[YTImport] done userId=%s channelId=%s channelTitle=%s fetched=%d upserted=%d", userID, channelID, channelTitle, fetched, upserted)
	return fetched, upserted, nil
}

func joinComma(items []string) string {
	// minimal to avoid strings import in this file.
	if len(items) == 0 {
		return ""
	}
	out := items[0]
	for i := 1; i < len(items); i++ {
		out += "," + items[i]
	}
	return out
}

var _ socialimport.Provider = YouTubeProvider{}
