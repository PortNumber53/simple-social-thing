package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PortNumber53/simple-social-thing/backend/internal/models"
	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport"
	"github.com/PortNumber53/simple-social-thing/backend/internal/socialimport/providers"
	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

type Handler struct {
	db *sql.DB
}

type userSetting struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

func New(db *sql.DB) *Handler {
	return &Handler{db: db}
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var user models.User
	if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO public."Users" (id, email, name, "imageUrl", "createdAt")
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (id) DO UPDATE SET
			-- Avoid clobbering existing values when callers don't know them (e.g. social-only OAuth callbacks)
			email = COALESCE(NULLIF(EXCLUDED.email, ''), public."Users".email),
			name = COALESCE(NULLIF(EXCLUDED.name, ''), public."Users".name),
			"imageUrl" = COALESCE(EXCLUDED."imageUrl", public."Users"."imageUrl")
		RETURNING id, email, name, "imageUrl", "createdAt"
	`

	err := h.db.QueryRow(query, user.ID, user.Email, user.Name, user.ImageURL).
		Scan(&user.ID, &user.Email, &user.Name, &user.ImageURL, &user.CreatedAt)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var user models.User
	query := `SELECT id, email, name, "imageUrl", "createdAt" FROM public."Users" WHERE id = $1`

	err := h.db.QueryRow(query, id).Scan(&user.ID, &user.Email, &user.Name, &user.ImageURL, &user.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var user models.User
	if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `
		UPDATE public."Users"
		SET email = $2, name = $3, "imageUrl" = $4
		WHERE id = $1
		RETURNING id, email, name, "imageUrl", "createdAt"
	`

	err := h.db.QueryRow(query, id, user.Email, user.Name, user.ImageURL).
		Scan(&user.ID, &user.Email, &user.Name, &user.ImageURL, &user.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *Handler) CreateSocialConnection(w http.ResponseWriter, r *http.Request) {
	var conn models.SocialConnection
	if err := json.NewDecoder(r.Body).Decode(&conn); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO public."SocialConnections" (id, "userId", provider, "providerId", email, name, "createdAt")
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT ("userId", provider) DO UPDATE SET
			"providerId" = EXCLUDED."providerId",
			email = EXCLUDED.email,
			name = EXCLUDED.name
		RETURNING id, "userId", provider, "providerId", email, name, "createdAt"
	`

	err := h.db.QueryRow(query, conn.ID, conn.UserID, conn.Provider, conn.ProviderID, conn.Email, conn.Name).
		Scan(&conn.ID, &conn.UserID, &conn.Provider, &conn.ProviderID, &conn.Email, &conn.Name, &conn.CreatedAt)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(conn)
}

func (h *Handler) GetUserSocialConnections(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]

	query := `SELECT id, "userId", provider, "providerId", email, name, "createdAt" FROM public."SocialConnections" WHERE "userId" = $1`

	rows, err := h.db.Query(query, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var connections []models.SocialConnection
	for rows.Next() {
		var conn models.SocialConnection
		if err := rows.Scan(&conn.ID, &conn.UserID, &conn.Provider, &conn.ProviderID, &conn.Email, &conn.Name, &conn.CreatedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		connections = append(connections, conn)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(connections)
}

func (h *Handler) CreateTeam(w http.ResponseWriter, r *http.Request) {
	var team models.Team
	if err := json.NewDecoder(r.Body).Decode(&team); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO public."Teams" (id, "owner_id", "current_tier", "createdAt")
		VALUES ($1, $2, $3, NOW())
		RETURNING id, "owner_id", "current_tier", "posts_created_today", "usage_reset_date", "ig_llat", "stripe_customer_id", "stripe_subscription_id", "createdAt"
	`

	err := h.db.QueryRow(query, team.ID, team.OwnerID, team.CurrentTier).
		Scan(&team.ID, &team.OwnerID, &team.CurrentTier, &team.PostsCreatedToday, &team.UsageResetDate, &team.IgLlat, &team.StripeCustomerID, &team.StripeSubscriptionID, &team.CreatedAt)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(team)
}

func (h *Handler) GetTeam(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var team models.Team
	query := `SELECT id, "owner_id", "current_tier", "posts_created_today", "usage_reset_date", "ig_llat", "stripe_customer_id", "stripe_subscription_id", "createdAt" FROM public."Teams" WHERE id = $1`

	err := h.db.QueryRow(query, id).Scan(&team.ID, &team.OwnerID, &team.CurrentTier, &team.PostsCreatedToday, &team.UsageResetDate, &team.IgLlat, &team.StripeCustomerID, &team.StripeSubscriptionID, &team.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Team not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(team)
}

func (h *Handler) GetUserTeams(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]

	query := `
		SELECT t.id, t."owner_id", t."current_tier", t."posts_created_today", t."usage_reset_date", t."ig_llat", t."stripe_customer_id", t."stripe_subscription_id", t."createdAt"
		FROM public."Teams" t
		LEFT JOIN public."TeamMembers" tm ON t.id = tm."team_id"
		WHERE t."owner_id" = $1 OR tm."user_id" = $1
	`

	rows, err := h.db.Query(query, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var teams []models.Team
	for rows.Next() {
		var team models.Team
		if err := rows.Scan(&team.ID, &team.OwnerID, &team.CurrentTier, &team.PostsCreatedToday, &team.UsageResetDate, &team.IgLlat, &team.StripeCustomerID, &team.StripeSubscriptionID, &team.CreatedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		teams = append(teams, team)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(teams)
}

type sunoStoreRequest struct {
	UserID      string `json:"userId"`
	Prompt      string `json:"prompt"`
	SunoTrackID string `json:"sunoTrackId"`
	AudioURL    string `json:"audioUrl"`
}

type sunoCreateTaskRequest struct {
	UserID string `json:"userId"`
	Prompt string `json:"prompt"`
	TaskID string `json:"taskId"`
	Model  string `json:"model"`
}

type sunoCreateTaskResponse struct {
	OK bool   `json:"ok"`
	ID string `json:"id"`
}

type sunoUpdateTrackRequest struct {
	SunoTrackID string `json:"sunoTrackId"`
	AudioURL    string `json:"audioUrl"`
	Status      string `json:"status"`
}

type sunoStoreResponse struct {
	OK       bool   `json:"ok"`
	ID       string `json:"id"`
	FilePath string `json:"filePath"`
}

type sunoTrackRow struct {
	ID          string     `json:"id"`
	UserID      *string    `json:"userId,omitempty"`
	Prompt      *string    `json:"prompt,omitempty"`
	TaskID      *string    `json:"taskId,omitempty"`
	Model       *string    `json:"model,omitempty"`
	SunoTrackID *string    `json:"sunoTrackId,omitempty"`
	AudioURL    *string    `json:"audioUrl,omitempty"`
	FilePath    *string    `json:"filePath,omitempty"`
	Status      *string    `json:"status,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   *time.Time `json:"updatedAt,omitempty"`
}

type socialLibraryRow struct {
	ID           string          `json:"id"`
	UserID       string          `json:"userId"`
	Network      string          `json:"network"`
	ContentType  string          `json:"contentType"`
	Title        *string         `json:"title,omitempty"`
	PermalinkURL *string         `json:"permalinkUrl,omitempty"`
	MediaURL     *string         `json:"mediaUrl,omitempty"`
	ThumbnailURL *string         `json:"thumbnailUrl,omitempty"`
	PostedAt     *time.Time      `json:"postedAt,omitempty"`
	Views        *int64          `json:"views,omitempty"`
	Likes        *int64          `json:"likes,omitempty"`
	RawPayload   json.RawMessage `json:"rawPayload"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

func (h *Handler) ListSunoTracksForUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	query := `
		SELECT id, user_id, prompt, task_id, model, suno_track_id, audio_url, file_path, status, created_at, updated_at
		FROM public."SunoTracks"
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 100
	`
	rows, err := h.db.Query(query, userID)
	if err != nil {
		log.Printf("[Suno][ListTracks] query error userId=%s err=%v", userID, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := make([]sunoTrackRow, 0)
	for rows.Next() {
		var row sunoTrackRow
		if err := rows.Scan(
			&row.ID,
			&row.UserID,
			&row.Prompt,
			&row.TaskID,
			&row.Model,
			&row.SunoTrackID,
			&row.AudioURL,
			&row.FilePath,
			&row.Status,
			&row.CreatedAt,
			&row.UpdatedAt,
		); err != nil {
			log.Printf("[Suno][ListTracks] scan error userId=%s err=%v", userID, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		out = append(out, row)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func (h *Handler) ListSocialLibrariesForUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	network := r.URL.Query().Get("network")
	contentType := r.URL.Query().Get("type")
	q := r.URL.Query().Get("q")
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	parseDate := func(s string) (*time.Time, error) {
		if s == "" {
			return nil, nil
		}
		if len(s) == 10 {
			t, err := time.Parse("2006-01-02", s)
			if err != nil {
				return nil, err
			}
			return &t, nil
		}
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return nil, err
		}
		return &t, nil
	}
	from, err := parseDate(fromStr)
	if err != nil {
		http.Error(w, "invalid from date", http.StatusBadRequest)
		return
	}
	to, err := parseDate(toStr)
	if err != nil {
		http.Error(w, "invalid to date", http.StatusBadRequest)
		return
	}
	// If "to" is date-only, treat as end-of-day inclusive.
	if to != nil && len(toStr) == 10 {
		t2 := to.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
		to = &t2
	}

	limit := 50
	if limitStr != "" {
		if n, err := fmt.Sscanf(limitStr, "%d", &limit); n == 0 || err != nil {
			http.Error(w, "invalid limit", http.StatusBadRequest)
			return
		}
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset := 0
	if offsetStr != "" {
		if n, err := fmt.Sscanf(offsetStr, "%d", &offset); n == 0 || err != nil {
			http.Error(w, "invalid offset", http.StatusBadRequest)
			return
		}
	}
	if offset < 0 {
		offset = 0
	}

	base := `
		SELECT id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url,
		       posted_at, views, likes, raw_payload, created_at, updated_at
		FROM public."SocialLibraries"
		WHERE user_id = $1
	`
	args := []interface{}{userID}
	argN := 2

	if network != "" {
		base += fmt.Sprintf(" AND network = $%d", argN)
		args = append(args, network)
		argN++
	}
	if contentType != "" {
		base += fmt.Sprintf(" AND content_type = $%d", argN)
		args = append(args, contentType)
		argN++
	}
	if from != nil {
		base += fmt.Sprintf(" AND posted_at >= $%d", argN)
		args = append(args, *from)
		argN++
	}
	if to != nil {
		base += fmt.Sprintf(" AND posted_at <= $%d", argN)
		args = append(args, *to)
		argN++
	}
	if q != "" {
		base += fmt.Sprintf(" AND (title ILIKE $%d OR permalink_url ILIKE $%d)", argN, argN)
		args = append(args, "%"+q+"%")
		argN++
	}

	base += fmt.Sprintf(" ORDER BY posted_at DESC NULLS LAST, created_at DESC LIMIT $%d OFFSET $%d", argN, argN+1)
	args = append(args, limit, offset)

	rows, err := h.db.Query(base, args...)
	if err != nil {
		log.Printf("[Library][List] query error userId=%s err=%v", userID, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := make([]socialLibraryRow, 0)
	for rows.Next() {
		var row socialLibraryRow
		var postedAt sql.NullTime
		var views sql.NullInt64
		var likes sql.NullInt64
		var raw []byte
		if err := rows.Scan(
			&row.ID,
			&row.UserID,
			&row.Network,
			&row.ContentType,
			&row.Title,
			&row.PermalinkURL,
			&row.MediaURL,
			&row.ThumbnailURL,
			&postedAt,
			&views,
			&likes,
			&raw,
			&row.CreatedAt,
			&row.UpdatedAt,
		); err != nil {
			log.Printf("[Library][List] scan error userId=%s err=%v", userID, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if postedAt.Valid {
			t := postedAt.Time
			row.PostedAt = &t
		}
		if views.Valid {
			v := views.Int64
			row.Views = &v
		}
		if likes.Valid {
			l := likes.Int64
			row.Likes = &l
		}
		if raw == nil {
			row.RawPayload = json.RawMessage(`{}`)
		} else {
			row.RawPayload = json.RawMessage(raw)
		}
		out = append(out, row)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func (h *Handler) SyncSocialLibrariesForUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	start := time.Now()
	log.Printf("[LibrarySync] start userId=%s", userID)

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	type providerResult struct {
		Fetched  int    `json:"fetched"`
		Upserted int    `json:"upserted"`
		Skipped  bool   `json:"skipped,omitempty"`
		Reason   string `json:"reason,omitempty"`
		Error    string `json:"error,omitempty"`
	}
	resp := struct {
		OK         bool                      `json:"ok"`
		UserID     string                    `json:"userId"`
		DurationMs int64                     `json:"durationMs"`
		Providers  map[string]providerResult `json:"providers"`
	}{OK: true, UserID: userID, Providers: map[string]providerResult{}}

	// Which providers to sync? Default: all known providers (stubs no-op).
	// Optional: ?providers=instagram,facebook,tiktok
	provQuery := r.URL.Query().Get("providers")
	want := map[string]bool{}
	if provQuery != "" {
		for _, p := range strings.Split(provQuery, ",") {
			pp := strings.TrimSpace(strings.ToLower(p))
			if pp != "" {
				want[pp] = true
			}
		}
	}
	all := []socialimport.Provider{
		providers.InstagramProvider{},
		providers.FacebookProvider{},
		providers.TikTokProvider{},
		providers.YouTubeProvider{},
		providers.XProvider{},
		providers.PinterestProvider{},
		providers.ThreadsProvider{},
	}
	selected := make([]socialimport.Provider, 0, len(all))
	if len(want) == 0 {
		selected = all
	} else {
		for _, p := range all {
			if want[p.Name()] {
				selected = append(selected, p)
			}
		}
	}

	runner := &socialimport.Runner{DB: h.db, Logger: log.Default()}
	results := runner.SyncAll(ctx, userID, selected)
	for _, rr := range results {
		resp.Providers[rr.Provider] = providerResult{
			Fetched:  rr.Fetched,
			Upserted: rr.Upserted,
			Skipped:  rr.Skipped,
			Reason:   rr.Reason,
			Error:    rr.Error,
		}
	}

	resp.DurationMs = time.Since(start).Milliseconds()
	log.Printf("[LibrarySync] done userId=%s dur=%dms", userID, resp.DurationMs)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

type publishPostRequest struct {
	Caption   string   `json:"caption"`
	Providers []string `json:"providers"`
	// Optional: restrict Facebook publishing to a subset of page IDs.
	FacebookPageIDs []string `json:"facebookPageIds"`
	DryRun          bool     `json:"dryRun"`
}

type publishProviderResult struct {
	OK      bool                   `json:"ok"`
	Posted  int                    `json:"posted,omitempty"`
	Error   string                 `json:"error,omitempty"`
	Details map[string]interface{} `json:"details,omitempty"`
}

type publishJob struct {
	ID         string
	UserID     string
	Status     string
	Providers  []string
	Caption    *string
	Request    json.RawMessage
	Result     json.RawMessage
	Error      *string
	CreatedAt  time.Time
	StartedAt  *time.Time
	FinishedAt *time.Time
	UpdatedAt  time.Time
}

// PublishSocialPostForUser publishes a caption-only post to one or more connected networks.
// For now, only Facebook Page posts are implemented; other providers return not_supported.
func (h *Handler) PublishSocialPostForUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	req, mediaFiles, err := parsePublishPostRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	caption := strings.TrimSpace(req.Caption)
	if caption == "" {
		http.Error(w, "caption is required", http.StatusBadRequest)
		return
	}
	// Ensure caption is valid UTF-8 (Postgres + downstream APIs).
	caption = strings.ReplaceAll(caption, "\x00", "")
	if !utf8.ValidString(caption) {
		caption = strings.ToValidUTF8(caption, "�")
	}

	want := map[string]bool{}
	if len(req.Providers) > 0 {
		for _, p := range req.Providers {
			pp := strings.TrimSpace(strings.ToLower(p))
			if pp != "" {
				want[pp] = true
			}
		}
	} else {
		// Default: attempt all known providers
		want["facebook"] = true
		want["instagram"] = true
		want["tiktok"] = true
		want["youtube"] = true
		want["pinterest"] = true
		want["threads"] = true
	}

	start := time.Now()
	log.Printf("[Publish] start userId=%s providers=%v", userID, req.Providers)

	results := map[string]publishProviderResult{}
	overallOK := true

	// Facebook: Post to all saved pages in facebook_oauth using page access tokens.
	if want["facebook"] {
		posted, err, details := h.publishFacebookPages(r.Context(), userID, caption, req.FacebookPageIDs, mediaFiles, req.DryRun)
		if err != nil {
			results["facebook"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
		} else {
			results["facebook"] = publishProviderResult{OK: true, Posted: posted, Details: details}
		}
	}

	// Instagram: publish image posts to the connected IG Business account.
	if want["instagram"] {
		posted, err, details := h.publishInstagram(r.Context(), r, userID, caption, mediaFiles, req.DryRun)
		if err != nil {
			results["instagram"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
		} else {
			results["instagram"] = publishProviderResult{OK: true, Posted: posted, Details: details}
		}
	}

	// Other providers: stub for now.
	for _, p := range []string{"tiktok", "youtube", "pinterest", "threads"} {
		if want[p] {
			results[p] = publishProviderResult{OK: false, Error: "not_supported_yet"}
			overallOK = false
		}
	}

	resp := map[string]interface{}{
		"ok":         overallOK,
		"userId":     userID,
		"durationMs": time.Since(start).Milliseconds(),
		"results":    results,
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// EnqueuePublishJobForUser enqueues a publishing job and returns immediately.
// The background job will execute the publishing fan-out and persist results back to Postgres.
func (h *Handler) EnqueuePublishJobForUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	reqObj, mediaFiles, err := parsePublishPostRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	caption := strings.TrimSpace(reqObj.Caption)
	if caption == "" {
		http.Error(w, "caption is required", http.StatusBadRequest)
		return
	}
	caption = strings.ReplaceAll(caption, "\x00", "")
	if !utf8.ValidString(caption) {
		caption = strings.ToValidUTF8(caption, "�")
	}

	// Store uploaded media immediately so the background job can reference it.
	relMedia, saveDetails, err := saveUploadedMedia(userID, mediaFiles)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Create job row
	jobID := fmt.Sprintf("pub_%s", randHex(12))
	now := time.Now()

	// Request snapshot stored for auditing/debugging
	reqSnapshot := map[string]interface{}{
		"caption":         caption,
		"providers":       reqObj.Providers,
		"facebookPageIds": reqObj.FacebookPageIDs,
		"dryRun":          reqObj.DryRun,
		"media":           relMedia,
		"publicOrigin":    publicOrigin(r),
	}
	reqJSON, _ := json.Marshal(reqSnapshot)

	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO public."PublishJobs"
		  (id, user_id, status, providers, caption, request_json, created_at, updated_at)
		VALUES
		  ($1, $2, 'queued', $3, $4, $5::jsonb, $6, $6)
	`, jobID, userID, pq.Array(reqObj.Providers), caption, string(reqJSON), now)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Fire and forget: run in background (uses DB for status, so any instance can serve status reads).
	go h.runPublishJob(jobID, userID, caption, reqObj, relMedia, publicOrigin(r))

	resp := map[string]interface{}{
		"ok":     true,
		"jobId":  jobID,
		"status": "queued",
		"saved":  saveDetails["saved"],
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// GetPublishJob returns the current job status + result (if finished).
func (h *Handler) GetPublishJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	jobID := mux.Vars(r)["jobId"]
	if strings.TrimSpace(jobID) == "" {
		http.Error(w, "jobId is required", http.StatusBadRequest)
		return
	}

	var (
		userID     string
		status     string
		providers  []string
		caption    sql.NullString
		reqJSON    []byte
		resJSON    []byte
		errText    sql.NullString
		createdAt  time.Time
		startedAt  sql.NullTime
		finishedAt sql.NullTime
		updatedAt  time.Time
	)

	row := h.db.QueryRowContext(r.Context(), `
		SELECT user_id, status, COALESCE(providers, ARRAY[]::text[]), COALESCE(caption,''), COALESCE(request_json, '{}'::jsonb), COALESCE(result_json, '{}'::jsonb),
		       COALESCE(error,''), created_at, started_at, finished_at, updated_at
		  FROM public."PublishJobs"
		 WHERE id = $1
	`, jobID)
	if err := row.Scan(&userID, &status, pq.Array(&providers), &caption, &reqJSON, &resJSON, &errText, &createdAt, &startedAt, &finishedAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "not_found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"ok":         true,
		"jobId":      jobID,
		"userId":     userID,
		"status":     status,
		"providers":  providers,
		"createdAt":  createdAt,
		"startedAt":  nullTimePtr(startedAt),
		"finishedAt": nullTimePtr(finishedAt),
		"updatedAt":  updatedAt,
	}
	if errText.Valid && errText.String != "" {
		resp["error"] = errText.String
	}
	resp["result"] = json.RawMessage(resJSON)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handler) runPublishJob(jobID, userID, caption string, req publishPostRequest, relMedia []string, origin string) {
	start := time.Now()
	defer func() {
		if rec := recover(); rec != nil {
			msg := fmt.Sprintf("panic: %v", rec)
			log.Printf("[PublishJob] panic jobId=%s userId=%s err=%s\n%s", jobID, userID, msg, string(debug.Stack()))
			_, _ = h.db.Exec(`
				UPDATE public."PublishJobs"
				   SET status='failed', error=$2, finished_at=NOW(), updated_at=NOW()
				 WHERE id=$1
			`, jobID, msg)
		}
	}()

	_, _ = h.db.Exec(`
		UPDATE public."PublishJobs"
		   SET status='running', started_at=NOW(), updated_at=NOW()
		 WHERE id=$1
	`, jobID)

	want := map[string]bool{}
	if len(req.Providers) > 0 {
		for _, p := range req.Providers {
			pp := strings.TrimSpace(strings.ToLower(p))
			if pp != "" {
				want[pp] = true
			}
		}
	} else {
		want["facebook"] = true
		want["instagram"] = true
		want["tiktok"] = true
		want["youtube"] = true
		want["pinterest"] = true
		want["threads"] = true
	}

	results := map[string]publishProviderResult{}
	overallOK := true

	var mediaFiles []uploadedMedia
	if len(relMedia) > 0 {
		mf, err := loadUploadedMediaFromRelPaths(relMedia)
		if err != nil {
			overallOK = false
			results["media"] = publishProviderResult{OK: false, Error: "failed_to_load_media", Details: map[string]interface{}{"error": err.Error()}}
		} else {
			mediaFiles = mf
		}
	}

	// Facebook
	if want["facebook"] {
		posted, err, details := h.publishFacebookPages(context.Background(), userID, caption, req.FacebookPageIDs, mediaFiles, req.DryRun)
		if err != nil {
			results["facebook"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
		} else {
			results["facebook"] = publishProviderResult{OK: true, Posted: posted, Details: details}
		}
	}

	// Instagram (requires public image URLs)
	if want["instagram"] {
		imageURLs := make([]string, 0, len(relMedia))
		for _, u := range relMedia {
			imageURLs = append(imageURLs, strings.TrimRight(origin, "/")+u)
		}
		posted, err, details := h.publishInstagramWithImageURLs(context.Background(), userID, caption, imageURLs, req.DryRun)
		if err != nil {
			results["instagram"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
		} else {
			results["instagram"] = publishProviderResult{OK: true, Posted: posted, Details: details}
		}
	}

	for _, p := range []string{"tiktok", "youtube", "pinterest", "threads"} {
		if want[p] {
			results[p] = publishProviderResult{OK: false, Error: "not_supported_yet"}
			overallOK = false
		}
	}

	resp := map[string]interface{}{
		"ok":         overallOK,
		"jobId":      jobID,
		"userId":     userID,
		"durationMs": time.Since(start).Milliseconds(),
		"results":    results,
	}
	resJSON, _ := json.Marshal(resp)

	finalStatus := "completed"
	var errText interface{} = nil
	if !overallOK {
		finalStatus = "failed"
		// keep a short summary in error column
		errText = "one_or_more_providers_failed"
	}

	_, _ = h.db.Exec(`
		UPDATE public."PublishJobs"
		   SET status=$2, result_json=$3::jsonb, error=COALESCE($4, error), finished_at=NOW(), updated_at=NOW()
		 WHERE id=$1
	`, jobID, finalStatus, string(resJSON), errText)

	log.Printf("[PublishJob] done jobId=%s userId=%s status=%s dur=%dms", jobID, userID, finalStatus, time.Since(start).Milliseconds())
}

type fbOAuthPageRow struct {
	ID          string   `json:"id"`
	Name        *string  `json:"name"`
	AccessToken string   `json:"access_token"`
	Tasks       []string `json:"tasks"`
}

type fbOAuthPayload struct {
	AccessToken string           `json:"accessToken"` // legacy single-page access token (page token)
	PageID      string           `json:"pageId"`
	PageName    string           `json:"pageName"`
	UserToken   string           `json:"userAccessToken"`
	Pages       []fbOAuthPageRow `json:"pages"`
}

func truncate(s string, max int) string {
	if max <= 0 {
		return ""
	}
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

type uploadedMedia struct {
	Filename    string
	ContentType string
	Bytes       []byte
}

var reSafeFilename = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func publicOrigin(r *http.Request) string {
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := r.Host
	if h := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); h != "" {
		host = h
	}
	return fmt.Sprintf("%s://%s", proto, host)
}

func randHex(n int) string {
	if n <= 0 {
		return ""
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func saveUploadedMedia(userID string, media []uploadedMedia) ([]string, map[string]interface{}, error) {
	details := map[string]interface{}{}
	if len(media) == 0 {
		return nil, details, nil
	}
	dir := filepath.Join("media", "uploads", userID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, details, err
	}
	rel := make([]string, 0, len(media))
	files := make([]map[string]interface{}, 0, len(media))
	for _, m := range media {
		name := strings.TrimSpace(m.Filename)
		if name == "" {
			name = "upload.bin"
		}
		name = reSafeFilename.ReplaceAllString(name, "_")
		fn := fmt.Sprintf("%s_%s", randHex(8), name)
		path := filepath.Join(dir, fn)
		if err := os.WriteFile(path, m.Bytes, 0o644); err != nil {
			return nil, details, err
		}
		rel = append(rel, fmt.Sprintf("/media/uploads/%s/%s", userID, fn))
		files = append(files, map[string]interface{}{
			"filename":    fn,
			"contentType": m.ContentType,
			"size":        len(m.Bytes),
		})
	}
	details["saved"] = files
	return rel, details, nil
}

func loadUploadedMediaFromRelPaths(relPaths []string) ([]uploadedMedia, error) {
	out := make([]uploadedMedia, 0, len(relPaths))
	for _, rel := range relPaths {
		rel = strings.TrimSpace(rel)
		if rel == "" {
			continue
		}
		// rel example: /media/uploads/<userId>/<file>
		local := strings.TrimPrefix(rel, "/media/")
		path := filepath.Clean(filepath.Join("media", local))
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		fn := filepath.Base(path)
		ct := http.DetectContentType(b)
		out = append(out, uploadedMedia{Filename: fn, ContentType: ct, Bytes: b})
	}
	return out, nil
}

func nullTimePtr(nt sql.NullTime) *time.Time {
	if !nt.Valid {
		return nil
	}
	t := nt.Time
	return &t
}

func parsePublishPostRequest(r *http.Request) (publishPostRequest, []uploadedMedia, error) {
	ct := r.Header.Get("Content-Type")
	if strings.Contains(ct, "multipart/form-data") {
		// 25MB for request parsing; files are read into memory below with additional caps.
		if err := r.ParseMultipartForm(25 << 20); err != nil {
			return publishPostRequest{}, nil, err
		}
		getStr := func(k string) string {
			if r.MultipartForm == nil || r.MultipartForm.Value == nil {
				return ""
			}
			if vv := r.MultipartForm.Value[k]; len(vv) > 0 {
				return vv[0]
			}
			return ""
		}

		var req publishPostRequest
		req.Caption = getStr("caption")
		req.DryRun = strings.TrimSpace(getStr("dryRun")) == "true"

		// providers: accept JSON array or comma-separated
		provRaw := strings.TrimSpace(getStr("providers"))
		if provRaw != "" {
			var arr []string
			if json.Unmarshal([]byte(provRaw), &arr) == nil && len(arr) > 0 {
				req.Providers = arr
			} else {
				for _, p := range strings.Split(provRaw, ",") {
					pp := strings.TrimSpace(p)
					if pp != "" {
						req.Providers = append(req.Providers, pp)
					}
				}
			}
		}

		pageRaw := strings.TrimSpace(getStr("facebookPageIds"))
		if pageRaw != "" {
			var arr []string
			if json.Unmarshal([]byte(pageRaw), &arr) == nil && len(arr) > 0 {
				req.FacebookPageIDs = arr
			} else {
				for _, p := range strings.Split(pageRaw, ",") {
					pp := strings.TrimSpace(p)
					if pp != "" {
						req.FacebookPageIDs = append(req.FacebookPageIDs, pp)
					}
				}
			}
		}

		// media files
		files := []*multipart.FileHeader{}
		if r.MultipartForm != nil && r.MultipartForm.File != nil {
			files = r.MultipartForm.File["media"]
		}
		out := make([]uploadedMedia, 0, len(files))
		const maxFiles = 5
		const maxFileSize = 6 << 20 // 6MB each
		for i, fh := range files {
			if i >= maxFiles {
				break
			}
			if fh == nil {
				continue
			}
			if fh.Size > maxFileSize {
				return publishPostRequest{}, nil, fmt.Errorf("media file too large: %s", fh.Filename)
			}
			f, err := fh.Open()
			if err != nil {
				return publishPostRequest{}, nil, err
			}
			b, err := io.ReadAll(io.LimitReader(f, maxFileSize))
			_ = f.Close()
			if err != nil {
				return publishPostRequest{}, nil, err
			}
			out = append(out, uploadedMedia{
				Filename:    fh.Filename,
				ContentType: fh.Header.Get("Content-Type"),
				Bytes:       b,
			})
		}
		return req, out, nil
	}

	// Default: JSON body
	var req publishPostRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return publishPostRequest{}, nil, err
	}
	return req, nil, nil
}

func (h *Handler) publishFacebookPages(ctx context.Context, userID string, caption string, pageIDs []string, media []uploadedMedia, dryRun bool) (int, error, map[string]interface{}) {
	details := map[string]interface{}{}
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public."UserSettings" WHERE user_id=$1 AND key='facebook_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, fmt.Errorf("not_connected"), details
		}
		return 0, err, details
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, fmt.Errorf("not_connected"), details
	}
	var tok fbOAuthPayload
	if err := json.Unmarshal(raw, &tok); err != nil {
		return 0, fmt.Errorf("invalid_oauth_payload"), map[string]interface{}{"raw": string(raw)}
	}

	pages := make([]fbOAuthPageRow, 0, len(tok.Pages))
	for _, p := range tok.Pages {
		if strings.TrimSpace(p.ID) != "" && strings.TrimSpace(p.AccessToken) != "" {
			pages = append(pages, p)
		}
	}
	// Backward compat: single page fields
	if len(pages) == 0 && tok.PageID != "" && tok.AccessToken != "" {
		name := tok.PageName
		pages = append(pages, fbOAuthPageRow{ID: tok.PageID, Name: &name, AccessToken: tok.AccessToken})
	}
	if len(pages) == 0 {
		return 0, fmt.Errorf("no_pages_found"), details
	}

	// Optional page filter
	if len(pageIDs) > 0 {
		allow := map[string]bool{}
		for _, id := range pageIDs {
			id = strings.TrimSpace(id)
			if id != "" {
				allow[id] = true
			}
		}
		filtered := make([]fbOAuthPageRow, 0, len(pages))
		for _, p := range pages {
			if allow[p.ID] {
				filtered = append(filtered, p)
			}
		}
		pages = filtered
		details["requestedPageIds"] = pageIDs
	}
	if len(pages) == 0 {
		return 0, fmt.Errorf("no_selected_pages"), details
	}

	type pageResult struct {
		PageID     string `json:"pageId"`
		Posted     bool   `json:"posted"`
		PostID     string `json:"postId,omitempty"`
		StatusCode int    `json:"statusCode,omitempty"`
		Error      string `json:"error,omitempty"`
		Body       string `json:"body,omitempty"`
	}
	pageResults := make([]pageResult, 0, len(pages))

	client := &http.Client{Timeout: 60 * time.Second}
	postedCount := 0
	for _, page := range pages {
		// If we have tasks, only attempt pages where user can create content.
		if len(page.Tasks) > 0 {
			canPost := false
			for _, t := range page.Tasks {
				tt := strings.ToUpper(strings.TrimSpace(t))
				if tt == "CREATE_CONTENT" || tt == "MANAGE" {
					canPost = true
					break
				}
			}
			if !canPost {
				pageResults = append(pageResults, pageResult{
					PageID: page.ID,
					Posted: false,
					Error:  "insufficient_page_role",
				})
				log.Printf("[FBPublish] skip userId=%s pageId=%s reason=insufficient_page_role tasks=%v", userID, page.ID, page.Tasks)
				continue
			}
		}

		if dryRun {
			pageResults = append(pageResults, pageResult{PageID: page.ID, Posted: false})
			continue
		}
		var endpoint string
		var req *http.Request
		var err error

		// If media is included, publish as a photo post (single) or feed post with attached media (multi).
		if len(media) > 0 {
			postID, status, bodyText, errMsg, err := fbPublishWithImages(ctx, client, page.ID, page.AccessToken, caption, media)
			if err != nil {
				pageResults = append(pageResults, pageResult{PageID: page.ID, Posted: false, StatusCode: status, Error: errMsg, Body: truncate(bodyText, 1200)})
				log.Printf("[FBPublish] non_2xx userId=%s pageId=%s status=%d body=%s", userID, page.ID, status, truncate(bodyText, 600))
				continue
			}
			pageResults = append(pageResults, pageResult{PageID: page.ID, Posted: true, PostID: postID, StatusCode: status})
			postedCount++
			log.Printf("[FBPublish] ok userId=%s pageId=%s postId=%s", userID, page.ID, postID)

			// Store as created content
			rawPayload := strings.ReplaceAll(bodyText, "\x00", "")
			if !utf8.ValidString(rawPayload) {
				rawPayload = strings.ToValidUTF8(rawPayload, "�")
			}
			if postID != "" {
				rowID := fmt.Sprintf("facebook:%s:%s", userID, postID)
				_, _ = h.db.ExecContext(ctx, `
					INSERT INTO public."SocialLibraries"
					  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
					VALUES
					  ($1, $2, 'facebook', 'post', NULLIF($3,''), NULL, NULL, NULL, NOW(), NULL, NULL, $4::jsonb, $5, NOW(), NOW())
					ON CONFLICT (user_id, network, external_id)
					DO UPDATE SET
					  title = EXCLUDED.title,
					  raw_payload = EXCLUDED.raw_payload,
					  updated_at = NOW()
				`, rowID, userID, caption, rawPayload, postID)
			}
			continue
		}

		// Caption-only post
		form := url.Values{}
		form.Set("message", caption)
		form.Set("access_token", page.AccessToken)
		endpoint = fmt.Sprintf("https://graph.facebook.com/v18.0/%s/feed", url.PathEscape(page.ID))
		req, err = http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
		if err != nil {
			pageResults = append(pageResults, pageResult{PageID: page.ID, Posted: false, Error: err.Error()})
			continue
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Accept", "application/json")

		res, err := client.Do(req)
		if err != nil {
			pageResults = append(pageResults, pageResult{PageID: page.ID, Posted: false, Error: err.Error()})
			log.Printf("[FBPublish] failed userId=%s pageId=%s err=%v", userID, page.ID, err)
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		_ = res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			bodyStr := truncate(string(body), 1200)
			// Best-effort: extract Facebook error message
			errMsg := bodyStr
			var fb map[string]interface{}
			if json.Unmarshal(body, &fb) == nil {
				if eObj, ok := fb["error"].(map[string]interface{}); ok {
					if m, ok := eObj["message"].(string); ok && m != "" {
						errMsg = m
					}
				}
			}
			pageResults = append(pageResults, pageResult{
				PageID:     page.ID,
				Posted:     false,
				StatusCode: res.StatusCode,
				Error:      truncate(errMsg, 400),
				Body:       bodyStr,
			})
			log.Printf("[FBPublish] non_2xx userId=%s pageId=%s status=%d body=%s", userID, page.ID, res.StatusCode, truncate(bodyStr, 600))
			continue
		}
		var obj map[string]interface{}
		_ = json.Unmarshal(body, &obj)
		postID, _ := obj["id"].(string)
		pageResults = append(pageResults, pageResult{PageID: page.ID, Posted: true, PostID: postID, StatusCode: res.StatusCode})
		postedCount++
		log.Printf("[FBPublish] ok userId=%s pageId=%s postId=%s", userID, page.ID, postID)

		// Store this in SocialLibraries as "created content"
		if postID != "" {
			rawPayload := strings.ReplaceAll(string(body), "\x00", "")
			if !utf8.ValidString(rawPayload) {
				rawPayload = strings.ToValidUTF8(rawPayload, "�")
			}
			rowID := fmt.Sprintf("facebook:%s:%s", userID, postID)
			_, _ = h.db.ExecContext(ctx, `
				INSERT INTO public."SocialLibraries"
				  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
				VALUES
				  ($1, $2, 'facebook', 'post', NULLIF($3,''), NULL, NULL, NULL, NOW(), NULL, NULL, $4::jsonb, $5, NOW(), NOW())
				ON CONFLICT (user_id, network, external_id)
				DO UPDATE SET
				  title = EXCLUDED.title,
				  raw_payload = EXCLUDED.raw_payload,
				  updated_at = NOW()
			`, rowID, userID, caption, rawPayload, postID)
		}
	}

	details["pages"] = pageResults
	// If *every* page errored, surface an error
	if postedCount == 0 && !dryRun {
		return 0, fmt.Errorf("no_posts_created"), details
	}
	return postedCount, nil, details
}

func fbPublishWithImages(ctx context.Context, client *http.Client, pageID, pageToken, caption string, media []uploadedMedia) (postID string, status int, bodyText string, errMsg string, err error) {
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	// One image: publish directly via /photos (creates a photo post).
	if len(media) == 1 {
		photoID, createdPostID, status, bodyText, errMsg, err := fbUploadPhoto(ctx, client, pageID, pageToken, caption, media[0], true)
		if err != nil {
			return "", status, bodyText, errMsg, err
		}
		if createdPostID != "" {
			return createdPostID, status, bodyText, "", nil
		}
		return photoID, status, bodyText, "", nil
	}

	// Multiple: upload unpublished photos, then create a feed post with attached_media.
	mediaIDs := make([]string, 0, len(media))
	for _, m := range media {
		photoID, _, status, bodyText, errMsg, err := fbUploadPhoto(ctx, client, pageID, pageToken, "", m, false)
		if err != nil {
			return "", status, bodyText, errMsg, err
		}
		if photoID != "" {
			mediaIDs = append(mediaIDs, photoID)
		}
	}
	if len(mediaIDs) == 0 {
		return "", 0, "", "no_media_uploaded", fmt.Errorf("no_media_uploaded")
	}

	form := url.Values{}
	form.Set("message", caption)
	form.Set("access_token", pageToken)
	for i, id := range mediaIDs {
		// Each value must be a JSON object string
		form.Set(fmt.Sprintf("attached_media[%d]", i), fmt.Sprintf(`{"media_fbid":"%s"}`, id))
	}
	endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/feed", url.PathEscape(pageID))
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, "", err.Error(), err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return "", 0, "", err.Error(), err
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	_ = res.Body.Close()
	bodyText = string(b)
	status = res.StatusCode
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		errMsg = extractFacebookErrorMessage(b, bodyText)
		return "", status, bodyText, errMsg, fmt.Errorf("facebook_non_2xx")
	}
	var obj map[string]interface{}
	_ = json.Unmarshal(b, &obj)
	if id, ok := obj["id"].(string); ok && id != "" {
		return id, status, bodyText, "", nil
	}
	return "", status, bodyText, "", nil
}

func extractFacebookErrorMessage(body []byte, fallback string) string {
	errMsg := fallback
	var fb map[string]interface{}
	if json.Unmarshal(body, &fb) == nil {
		if eObj, ok := fb["error"].(map[string]interface{}); ok {
			if m, ok := eObj["message"].(string); ok && m != "" {
				errMsg = m
			}
		}
	}
	return truncate(errMsg, 400)
}

func fbUploadPhoto(ctx context.Context, client *http.Client, pageID, pageToken, caption string, media uploadedMedia, published bool) (photoID string, postID string, status int, bodyText string, errMsg string, err error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	// Standard fields
	_ = w.WriteField("access_token", pageToken)
	if caption != "" {
		_ = w.WriteField("message", caption)
	}
	if published {
		_ = w.WriteField("published", "true")
	} else {
		_ = w.WriteField("published", "false")
	}

	fw, err := w.CreateFormFile("source", media.Filename)
	if err != nil {
		_ = w.Close()
		return "", "", 0, "", err.Error(), err
	}
	_, _ = fw.Write(media.Bytes)
	_ = w.Close()

	endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/photos", url.PathEscape(pageID))
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(buf.Bytes()))
	if err != nil {
		return "", "", 0, "", err.Error(), err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Accept", "application/json")

	res, err := client.Do(req)
	if err != nil {
		return "", "", 0, "", err.Error(), err
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	_ = res.Body.Close()
	bodyText = string(b)
	status = res.StatusCode
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		errMsg = extractFacebookErrorMessage(b, bodyText)
		return "", "", status, bodyText, errMsg, fmt.Errorf("facebook_non_2xx")
	}
	var obj map[string]interface{}
	_ = json.Unmarshal(b, &obj)
	if id, ok := obj["id"].(string); ok {
		photoID = id
	}
	if pid, ok := obj["post_id"].(string); ok {
		postID = pid
	}
	return photoID, postID, status, bodyText, "", nil
}

type instagramOAuth struct {
	AccessToken  string `json:"accessToken"`
	IGBusinessID string `json:"igBusinessId"`
	PageID       string `json:"pageId"`
	Username     string `json:"username"`
	ExpiresAt    string `json:"expiresAt"`
}

func (h *Handler) publishInstagramWithImageURLs(ctx context.Context, userID, caption string, imageURLs []string, dryRun bool) (int, error, map[string]interface{}) {
	details := map[string]interface{}{"imageUrls": imageURLs}
	if len(imageURLs) == 0 {
		return 0, fmt.Errorf("instagram_requires_image"), details
	}
	// Load IG token + business account id from UserSettings
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public."UserSettings" WHERE user_id=$1 AND key='instagram_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, fmt.Errorf("not_connected"), details
		}
		return 0, err, details
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, fmt.Errorf("not_connected"), details
	}
	var tok instagramOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return 0, fmt.Errorf("invalid_oauth_payload"), map[string]interface{}{"raw": truncate(string(raw), 800)}
	}
	if strings.TrimSpace(tok.AccessToken) == "" || strings.TrimSpace(tok.IGBusinessID) == "" {
		return 0, fmt.Errorf("not_connected"), details
	}

	if dryRun {
		return 0, nil, map[string]interface{}{"dryRun": true, "mediaCount": len(imageURLs), "imageUrls": imageURLs}
	}

	client := &http.Client{Timeout: 60 * time.Second}
	accessToken := tok.AccessToken
	igID := tok.IGBusinessID

	waitForContainer := func(containerID string) (string, error) {
		// Poll container status until FINISHED to avoid:
		// OAuthException code=9007 subcode=2207027 "Media ID is not available" / "media is not ready for publishing".
		// See: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/
		type statusResp struct {
			ID         string `json:"id"`
			StatusCode string `json:"status_code"`
		}
		var last string
		for i := 0; i < 30; i++ { // ~60s worst case
			if i > 0 {
				time.Sleep(2 * time.Second)
			}
			endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s?fields=status_code&access_token=%s",
				url.PathEscape(containerID),
				url.QueryEscape(accessToken),
			)
			req, _ := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
			req.Header.Set("Accept", "application/json")
			res, err := client.Do(req)
			if err != nil {
				last = "request_error"
				continue
			}
			b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			_ = res.Body.Close()
			if res.StatusCode < 200 || res.StatusCode >= 300 {
				last = fmt.Sprintf("http_%d", res.StatusCode)
				continue
			}
			var sr statusResp
			if err := json.Unmarshal(b, &sr); err != nil {
				last = "bad_json"
				continue
			}
			last = strings.ToUpper(strings.TrimSpace(sr.StatusCode))
			if last == "FINISHED" {
				return last, nil
			}
			if last == "ERROR" || last == "EXPIRED" {
				return last, fmt.Errorf("instagram_container_%s", strings.ToLower(last))
			}
		}
		return last, fmt.Errorf("instagram_container_not_ready")
	}

	// Create media containers (children for carousel, or the single post container).
	containerIDs := []string{}
	for _, img := range imageURLs {
		form := url.Values{}
		form.Set("image_url", img)
		form.Set("access_token", accessToken)
		if len(imageURLs) > 1 {
			form.Set("is_carousel_item", "true")
		} else {
			form.Set("caption", caption)
		}
		endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/media", url.PathEscape(igID))
		req, _ := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Accept", "application/json")

		res, err := client.Do(req)
		if err != nil {
			return 0, err, details
		}
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		_ = res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			msg := extractFacebookErrorMessage(b, string(b))
			return 0, fmt.Errorf("instagram_container_failed"), map[string]interface{}{"status": res.StatusCode, "error": msg, "body": truncate(string(b), 1200)}
		}
		var obj map[string]interface{}
		_ = json.Unmarshal(b, &obj)
		id, _ := obj["id"].(string)
		if id == "" {
			return 0, fmt.Errorf("instagram_missing_container_id"), map[string]interface{}{"body": truncate(string(b), 1200)}
		}
		containerIDs = append(containerIDs, id)

		// Wait until the container is ready.
		if st, err := waitForContainer(id); err != nil {
			return 0, fmt.Errorf("instagram_container_not_ready"), map[string]interface{}{"containerId": id, "status": st}
		}
	}
	details["containerIds"] = containerIDs

	creationID := ""
	if len(containerIDs) > 1 {
		// Parent carousel container
		form := url.Values{}
		form.Set("media_type", "CAROUSEL")
		form.Set("children", strings.Join(containerIDs, ","))
		form.Set("caption", caption)
		form.Set("access_token", accessToken)
		endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/media", url.PathEscape(igID))
		req, _ := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Accept", "application/json")
		res, err := client.Do(req)
		if err != nil {
			return 0, err, details
		}
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		_ = res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			msg := extractFacebookErrorMessage(b, string(b))
			return 0, fmt.Errorf("instagram_carousel_failed"), map[string]interface{}{"status": res.StatusCode, "error": msg, "body": truncate(string(b), 1200)}
		}
		var obj map[string]interface{}
		_ = json.Unmarshal(b, &obj)
		creationID, _ = obj["id"].(string)
	} else {
		creationID = containerIDs[0]
	}
	if creationID == "" {
		return 0, fmt.Errorf("instagram_missing_creation_id"), details
	}

	// Wait for carousel parent container too.
	if len(containerIDs) > 1 {
		if st, err := waitForContainer(creationID); err != nil {
			return 0, fmt.Errorf("instagram_container_not_ready"), map[string]interface{}{"containerId": creationID, "status": st}
		}
	}

	// Publish
	form := url.Values{}
	form.Set("creation_id", creationID)
	form.Set("access_token", accessToken)
	endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/media_publish", url.PathEscape(igID))
	req, _ := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return 0, err, details
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	_ = res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := extractFacebookErrorMessage(b, string(b))
		return 0, fmt.Errorf("instagram_publish_failed"), map[string]interface{}{"status": res.StatusCode, "error": msg, "body": truncate(string(b), 1200)}
	}
	var pub map[string]interface{}
	_ = json.Unmarshal(b, &pub)
	mediaID, _ := pub["id"].(string)
	details["publishedId"] = mediaID

	// Store created item in SocialLibraries
	if mediaID != "" {
		rawPayload := strings.ReplaceAll(string(b), "\x00", "")
		if !utf8.ValidString(rawPayload) {
			rawPayload = strings.ToValidUTF8(rawPayload, "�")
		}
		rowID := fmt.Sprintf("instagram:%s:%s", userID, mediaID)
		_, _ = h.db.ExecContext(ctx, `
			INSERT INTO public."SocialLibraries"
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'instagram', 'post', NULLIF($3,''), NULL, NULL, NULL, NOW(), NULL, NULL, $4::jsonb, $5, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  title = EXCLUDED.title,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, rowID, userID, caption, rawPayload, mediaID)
	}

	log.Printf("[IGPublish] ok userId=%s igBusinessId=%s mediaId=%s", userID, tok.IGBusinessID, mediaID)
	return 1, nil, details
}

func (h *Handler) publishInstagram(ctx context.Context, r *http.Request, userID, caption string, media []uploadedMedia, dryRun bool) (int, error, map[string]interface{}) {
	details := map[string]interface{}{}
	if len(media) == 0 {
		return 0, fmt.Errorf("instagram_requires_image"), details
	}
	rel, saveDetails, err := saveUploadedMedia(userID, media)
	if err != nil {
		return 0, err, details
	}
	for k, v := range saveDetails {
		details[k] = v
	}
	origin := publicOrigin(r)
	imageURLs := make([]string, 0, len(rel))
	for _, u := range rel {
		imageURLs = append(imageURLs, origin+u)
	}
	posted, err2, det2 := h.publishInstagramWithImageURLs(ctx, userID, caption, imageURLs, dryRun)
	for k, v := range det2 {
		details[k] = v
	}
	return posted, err2, details
}

func (h *Handler) StoreSunoTrack(w http.ResponseWriter, r *http.Request) {
	var req sunoStoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[Suno][Store] invalid JSON: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.AudioURL == "" {
		log.Printf("[Suno][Store] missing audioUrl in request: %+v", req)
		http.Error(w, "audioUrl is required", http.StatusBadRequest)
		return
	}

	log.Printf("[Suno][Store] downloading audio userId=%s sunoTrackId=%s url=%s", req.UserID, req.SunoTrackID, req.AudioURL)
	resp, err := http.Get(req.AudioURL)
	if err != nil {
		log.Printf("[Suno][Store] download error: %v", err)
		http.Error(w, fmt.Sprintf("failed to download audio: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[Suno][Store] download non-2xx: %d", resp.StatusCode)
		http.Error(w, fmt.Sprintf("downstream responded with %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	mediaDir := "media/suno"
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		log.Printf("[Suno][Store] mkdir error: %v", err)
		http.Error(w, fmt.Sprintf("failed to create media dir: %v", err), http.StatusInternalServerError)
		return
	}

	id := fmt.Sprintf("suno-%d", time.Now().UnixNano())
	fileName := fmt.Sprintf("%s.mp3", id)
	filePath := filepath.Join(mediaDir, fileName)

	out, err := os.Create(filePath)
	if err != nil {
		log.Printf("[Suno][Store] create file error: %v", err)
		http.Error(w, fmt.Sprintf("failed to create file: %v", err), http.StatusInternalServerError)
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		log.Printf("[Suno][Store] save file error: %v", err)
		http.Error(w, fmt.Sprintf("failed to save file: %v", err), http.StatusInternalServerError)
		return
	}

	query := `
		INSERT INTO public."SunoTracks" (id, user_id, prompt, suno_track_id, audio_url, file_path, status, updated_at)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5, $6, 'completed', NOW())
	`
	if _, err := h.db.Exec(query, id, req.UserID, req.Prompt, req.SunoTrackID, req.AudioURL, filePath); err != nil {
		log.Printf("[Suno][Store] DB insert error: %v", err)
		http.Error(w, fmt.Sprintf("failed to insert metadata: %v", err), http.StatusInternalServerError)
		return
	}
	log.Printf("[Suno][Store] stored id=%s file=%s userId=%s", id, filePath, req.UserID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sunoStoreResponse{
		OK:       true,
		ID:       id,
		FilePath: filePath,
	})
}

// SunoMusicCallback receives async generation callbacks from the SunoAPI provider.
// We currently accept and log the payload for observability and return 200 quickly.
// Docs: https://docs.sunoapi.org/suno-api/generate-music (Music Generation Callbacks)
func (h *Handler) SunoMusicCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB cap
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	// Parse minimally so we can update the track row by task_id.
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		log.Printf("[Suno][Callback] invalid JSON err=%v body=%s", err, string(body))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}

	getMap := func(v interface{}) map[string]interface{} {
		if m, ok := v.(map[string]interface{}); ok {
			return m
		}
		return nil
	}
	getString2 := func(v interface{}) string {
		if s, ok := v.(string); ok {
			return s
		}
		return ""
	}

	data := getMap(payload["data"])
	taskID := getString2(data["taskId"])
	statusRaw := getString2(data["status"])
	if taskID == "" {
		log.Printf("[Suno][Callback] missing taskId payload=%s", string(body))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}

	// Find our internal track row by task_id.
	var trackID string
	if err := h.db.QueryRow(`SELECT id FROM public."SunoTracks" WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`, taskID).Scan(&trackID); err != nil {
		log.Printf("[Suno][Callback] no track for taskId=%s err=%v payload=%s", taskID, err, string(body))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}

	// Extract first audioUrl + provider track id if present.
	var audioURL, sunoTrackID string
	respObj := getMap(data["response"])
	sunoDataAny := respObj["sunoData"]
	if arr, ok := sunoDataAny.([]interface{}); ok && len(arr) > 0 {
		if first := getMap(arr[0]); first != nil {
			audioURL = getString2(first["audioUrl"])
			sunoTrackID = getString2(first["id"])
		}
	}

	// Map provider status to our status.
	status := "pending"
	switch statusRaw {
	case "SUCCESS":
		status = "completed"
	case "FAILED":
		status = "failed"
	}

	// If completed and we have an audio URL, download and store like UpdateSunoTrack does.
	var filePath string
	if status == "completed" && audioURL != "" {
		log.Printf("[Suno][Callback] downloading audio taskId=%s id=%s url=%s", taskID, trackID, audioURL)
		resp, err := http.Get(audioURL)
		if err != nil {
			log.Printf("[Suno][Callback] download error id=%s err=%v", trackID, err)
		} else {
			defer resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				mediaDir := "media/suno"
				if err := os.MkdirAll(mediaDir, 0o755); err != nil {
					log.Printf("[Suno][Callback] mkdir error: %v", err)
				} else {
					fileName := fmt.Sprintf("%s.mp3", trackID)
					filePath = filepath.Join(mediaDir, fileName)
					out, err := os.Create(filePath)
					if err != nil {
						log.Printf("[Suno][Callback] create file error: %v", err)
					} else {
						if _, err := io.Copy(out, resp.Body); err != nil {
							log.Printf("[Suno][Callback] save file error: %v", err)
							_ = out.Close()
						} else {
							_ = out.Close()
						}
					}
				}
			} else {
				log.Printf("[Suno][Callback] download non-2xx: %d", resp.StatusCode)
			}
		}
	}

	_, err = h.db.Exec(`
		UPDATE public."SunoTracks"
		SET suno_track_id = COALESCE(NULLIF($1, ''), suno_track_id),
		    audio_url = COALESCE(NULLIF($2, ''), audio_url),
		    file_path = COALESCE(NULLIF($3, ''), file_path),
		    status = COALESCE(NULLIF($4, ''), status),
		    updated_at = NOW()
		WHERE id = $5
	`, sunoTrackID, audioURL, filePath, status, trackID)
	if err != nil {
		log.Printf("[Suno][Callback] DB update error id=%s taskId=%s err=%v", trackID, taskID, err)
	}

	log.Printf("[Suno][Callback] updated id=%s taskId=%s status=%s", trackID, taskID, status)
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (h *Handler) CreateSunoTask(w http.ResponseWriter, r *http.Request) {
	var req sunoCreateTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[Suno][CreateTask] invalid JSON: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.TaskID == "" {
		log.Printf("[Suno][CreateTask] missing taskId")
		http.Error(w, "taskId is required", http.StatusBadRequest)
		return
	}

	id := fmt.Sprintf("suno-%d", time.Now().UnixNano())
	query := `
		INSERT INTO public."SunoTracks" (id, user_id, prompt, task_id, model, status, created_at, updated_at)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, 'pending', NOW(), NOW())
	`
	if _, err := h.db.Exec(query, id, req.UserID, req.Prompt, req.TaskID, req.Model); err != nil {
		log.Printf("[Suno][CreateTask] DB insert error: %v", err)
		http.Error(w, fmt.Sprintf("failed to insert task: %v", err), http.StatusInternalServerError)
		return
	}
	log.Printf("[Suno][CreateTask] created id=%s taskId=%s userId=%s", id, req.TaskID, req.UserID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sunoCreateTaskResponse{
		OK: true,
		ID: id,
	})
}

func (h *Handler) UpdateSunoTrack(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	trackID := vars["id"]
	var req sunoUpdateTrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[Suno][UpdateTrack] invalid JSON: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Download audio if URL provided and status is completed
	var filePath string
	if req.AudioURL != "" && req.Status == "completed" {
		log.Printf("[Suno][UpdateTrack] downloading audio id=%s url=%s", trackID, req.AudioURL)
		resp, err := http.Get(req.AudioURL)
		if err != nil {
			log.Printf("[Suno][UpdateTrack] download error: %v", err)
			http.Error(w, fmt.Sprintf("failed to download audio: %v", err), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			log.Printf("[Suno][UpdateTrack] download non-2xx: %d", resp.StatusCode)
			http.Error(w, fmt.Sprintf("downstream responded with %d", resp.StatusCode), http.StatusBadGateway)
			return
		}

		mediaDir := "media/suno"
		if err := os.MkdirAll(mediaDir, 0o755); err != nil {
			log.Printf("[Suno][UpdateTrack] mkdir error: %v", err)
			http.Error(w, fmt.Sprintf("failed to create media dir: %v", err), http.StatusInternalServerError)
			return
		}

		fileName := fmt.Sprintf("%s.mp3", trackID)
		filePath = filepath.Join(mediaDir, fileName)

		out, err := os.Create(filePath)
		if err != nil {
			log.Printf("[Suno][UpdateTrack] create file error: %v", err)
			http.Error(w, fmt.Sprintf("failed to create file: %v", err), http.StatusInternalServerError)
			return
		}
		defer out.Close()

		if _, err := io.Copy(out, resp.Body); err != nil {
			log.Printf("[Suno][UpdateTrack] save file error: %v", err)
			http.Error(w, fmt.Sprintf("failed to save file: %v", err), http.StatusInternalServerError)
			return
		}
	}

	query := `
		UPDATE public."SunoTracks"
		SET suno_track_id = COALESCE(NULLIF($1, ''), suno_track_id),
		    audio_url = COALESCE(NULLIF($2, ''), audio_url),
		    file_path = COALESCE(NULLIF($3, ''), file_path),
		    status = COALESCE(NULLIF($4, ''), status),
		    updated_at = NOW()
		WHERE id = $5
	`
	if _, err := h.db.Exec(query, req.SunoTrackID, req.AudioURL, filePath, req.Status, trackID); err != nil {
		log.Printf("[Suno][UpdateTrack] DB update error: %v", err)
		http.Error(w, fmt.Sprintf("failed to update track: %v", err), http.StatusInternalServerError)
		return
	}
	log.Printf("[Suno][UpdateTrack] updated id=%s status=%s", trackID, req.Status)

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func (h *Handler) GetUserSetting(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	settingKey := vars["key"]
	log.Printf("[UserSettings][Get] userId=%s key=%s", userID, settingKey)

	query := `SELECT value FROM public."UserSettings" WHERE user_id = $1 AND key = $2`
	var raw []byte
	err := h.db.QueryRow(query, userID, settingKey).Scan(&raw)
	if err == sql.ErrNoRows {
		log.Printf("[UserSettings][Get] not found userId=%s key=%s", userID, settingKey)
		w.WriteHeader(http.StatusNotFound)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"error":"not_found"}`))
		return
	}
	if err != nil {
		log.Printf("[UserSettings][Get] query error userId=%s key=%s err=%v", userID, settingKey, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(fmt.Sprintf(`{"key":"%s","value":%s}`, settingKey, string(raw))))
}

func (h *Handler) UpsertUserSetting(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	settingKey := vars["key"]
	log.Printf("[UserSettings][Upsert] userId=%s key=%s", userID, settingKey)

	var body struct {
		Value interface{} `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		log.Printf("[UserSettings][Upsert] invalid JSON userId=%s key=%s err=%v", userID, settingKey, err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	valueBytes, err := json.Marshal(body.Value)
	if err != nil {
		log.Printf("[UserSettings][Upsert] marshal error userId=%s key=%s err=%v", userID, settingKey, err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO public."UserSettings" (user_id, key, value, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`
	if _, err := h.db.Exec(query, userID, settingKey, valueBytes); err != nil {
		log.Printf("[UserSettings][Upsert] DB upsert error userId=%s key=%s err=%v", userID, settingKey, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("[UserSettings][Upsert] success userId=%s key=%s", userID, settingKey)

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func (h *Handler) GetUserSettings(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	query := `SELECT key, value FROM public."UserSettings" WHERE user_id = $1`
	rows, err := h.db.Query(query, userID)
	if err != nil {
		log.Printf("[UserSettings][GetAll] query error userId=%s err=%v", userID, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var k string
		var raw []byte
		if err := rows.Scan(&k, &raw); err != nil {
			log.Printf("[UserSettings][GetAll] scan error userId=%s err=%v", userID, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		out[k] = json.RawMessage(raw)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": out})
}
