package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
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
	rt *realtimeHub
}

type userSetting struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

func New(db *sql.DB) *Handler {
	return &Handler{db: db, rt: newRealtimeHub()}
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var user models.User
	if err := decodeJSON(r, &user); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	query := `
		INSERT INTO public.users (id, email, name, image_url, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (id) DO UPDATE SET
			-- Avoid clobbering existing values when callers don't know them (e.g. social-only OAuth callbacks)
			email = COALESCE(NULLIF(EXCLUDED.email, ''), public.users.email),
			name = COALESCE(NULLIF(EXCLUDED.name, ''), public.users.name),
			image_url = COALESCE(EXCLUDED.image_url, public.users.image_url)
		RETURNING id, email, name, image_url, created_at
	`

	err := h.db.QueryRow(query, user.ID, user.Email, user.Name, user.ImageURL).
		Scan(&user.ID, &user.Email, &user.Name, &user.ImageURL, &user.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	id := pathVar(r, "id")

	var user models.User
	query := `SELECT id, email, name, image_url, created_at FROM public.users WHERE id = $1`

	err := h.db.QueryRow(query, id).Scan(&user.ID, &user.Email, &user.Name, &user.ImageURL, &user.CreatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id := pathVar(r, "id")

	var user models.User
	if err := decodeJSON(r, &user); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	query := `
		UPDATE public.users
		SET email = $2, name = $3, image_url = $4
		WHERE id = $1
		RETURNING id, email, name, image_url, created_at
	`

	err := h.db.QueryRow(query, id, user.Email, user.Name, user.ImageURL).
		Scan(&user.ID, &user.Email, &user.Name, &user.ImageURL, &user.CreatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (h *Handler) CreateSocialConnection(w http.ResponseWriter, r *http.Request) {
	var conn models.SocialConnection
	if err := json.NewDecoder(r.Body).Decode(&conn); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO public.social_connections (id, user_id, provider, provider_id, email, name, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (user_id, provider) DO UPDATE SET
			provider_id = EXCLUDED.provider_id,
			email = EXCLUDED.email,
			name = EXCLUDED.name
		RETURNING id, user_id, provider, provider_id, email, name, created_at
	`

	err := h.db.QueryRow(query, conn.ID, conn.UserID, conn.Provider, conn.ProviderID, conn.Email, conn.Name).
		Scan(&conn.ID, &conn.UserID, &conn.Provider, &conn.ProviderID, &conn.Email, &conn.Name, &conn.CreatedAt)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, conn)
}

func (h *Handler) GetUserSocialConnections(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]

	query := `SELECT id, user_id, provider, provider_id, email, name, created_at FROM public.social_connections WHERE user_id = $1`

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

	writeJSON(w, http.StatusOK, connections)
}

func (h *Handler) CreateTeam(w http.ResponseWriter, r *http.Request) {
	var team models.Team
	if err := decodeJSON(r, &team); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	query := `
		INSERT INTO public.teams (id, owner_id, current_tier, created_at)
		VALUES ($1, $2, $3, NOW())
		RETURNING id, "owner_id", "current_tier", "posts_created_today", "usage_reset_date", "ig_llat", "stripe_customer_id", "stripe_subscription_id", created_at
	`

	err := h.db.QueryRow(query, team.ID, team.OwnerID, team.CurrentTier).
		Scan(&team.ID, &team.OwnerID, &team.CurrentTier, &team.PostsCreatedToday, &team.UsageResetDate, &team.IgLlat, &team.StripeCustomerID, &team.StripeSubscriptionID, &team.CreatedAt)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, team)
}

func (h *Handler) GetTeam(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var team models.Team
	query := `SELECT id, owner_id, current_tier, posts_created_today, usage_reset_date, ig_llat, stripe_customer_id, stripe_subscription_id, created_at FROM public.teams WHERE id = $1`

	err := h.db.QueryRow(query, id).Scan(&team.ID, &team.OwnerID, &team.CurrentTier, &team.PostsCreatedToday, &team.UsageResetDate, &team.IgLlat, &team.StripeCustomerID, &team.StripeSubscriptionID, &team.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, "Team not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, team)
}

func (h *Handler) GetUserTeams(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]

	query := `
		SELECT t.id, t.owner_id, t.current_tier, t.posts_created_today, t.usage_reset_date, t.ig_llat, t.stripe_customer_id, t.stripe_subscription_id, t.created_at
		FROM public.teams t
		LEFT JOIN public.team_members tm ON t.id = tm.team_id
		WHERE t.owner_id = $1 OR tm.user_id = $1
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

	writeJSON(w, http.StatusOK, teams)
}

type sunoStoreRequest struct {
	UserID      string `json:"user_id"`
	Prompt      string `json:"prompt"`
	SunoTrackID string `json:"sunoTrackId"`
	TrackID     string `json:"trackId"`
	AudioURL    string `json:"audioUrl"`
	URL         string `json:"url"`
	Title       string `json:"title"`
}

type sunoCreateTaskRequest struct {
	UserID string `json:"user_id"`
	Prompt string `json:"prompt"`
	TaskID string `json:"taskId"`
	Model  string `json:"model"`
}

type sunoCreateTaskResponse struct {
	OK bool   `json:"ok"`
	ID string `json:"id"`
}

type sunoUpdateTrackRequest struct {
	Title       string `json:"title"`
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
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   *time.Time `json:"updatedAt,omitempty"`
}

type socialLibraryRow struct {
	ID           string          `json:"id"`
	UserID       string          `json:"user_id"`
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
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

type deleteSocialLibrariesRequest struct {
	IDs            []string `json:"ids"`
	DeleteExternal bool     `json:"deleteExternal,omitempty"`
}

type deleteSocialLibrariesResponse struct {
	OK       bool     `json:"ok"`
	Deleted  int64    `json:"deleted"`
	IDs      []string `json:"ids,omitempty"`
	External *struct {
		Attempted bool `json:"attempted"`
		Deleted   int  `json:"deleted"`
		Failed    []struct {
			ID      string `json:"id"`
			Network string `json:"network"`
			Reason  string `json:"reason"`
		} `json:"failed,omitempty"`
	} `json:"external,omitempty"`
}

type notificationRow struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Body      *string    `json:"body,omitempty"`
	URL       *string    `json:"url,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	ReadAt    *time.Time `json:"readAt,omitempty"`
}

type createOrUpdatePostRequest struct {
	// Optional. If empty on create, the server will generate one.
	ID *string `json:"id,omitempty"`

	Content      *string    `json:"content,omitempty"`
	Status       *string    `json:"status,omitempty"`
	Providers    []string   `json:"providers,omitempty"`
	Media        []string   `json:"media,omitempty"`
	ScheduledFor *time.Time `json:"scheduledFor,omitempty"`
	PublishedAt  *time.Time `json:"publishedAt,omitempty"`
}

type uploadItem struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	URL         string `json:"url"`
	ContentType string `json:"contentType,omitempty"`
	Size        int    `json:"size,omitempty"`
	Kind        string `json:"kind,omitempty"` // image | video | other
}

type uploadsListResponse struct {
	OK    bool         `json:"ok"`
	Items []uploadItem `json:"items"`
}

type uploadsUploadResponse struct {
	OK    bool         `json:"ok"`
	Items []uploadItem `json:"items"`
}

type deleteUploadsRequest struct {
	IDs []string `json:"ids"`
}

type deleteUploadsResponse struct {
	OK      bool  `json:"ok"`
	Deleted int64 `json:"deleted"`
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
		FROM public.suno_tracks
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

	writeJSON(w, http.StatusOK, out)
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
	postedOnly := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("posted"))) == "true"
	draftsOnly := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("drafts"))) == "true"
	if postedOnly && draftsOnly {
		http.Error(w, "posted and drafts cannot both be true", http.StatusBadRequest)
		return
	}

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
		FROM public.social_libraries
		WHERE user_id = $1
	`
	args := []interface{}{userID}
	argN := 2

	if postedOnly {
		base += " AND posted_at IS NOT NULL"
	}
	if draftsOnly {
		base += " AND posted_at IS NULL"
	}
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

	writeJSON(w, http.StatusOK, out)
}

type importSocialLibraryRequest struct {
	URL       string `json:"url"`
	Provider  string `json:"provider"`
	Notes     string `json:"notes"`
	Selection string `json:"selection"`
	Meta      any    `json:"meta"`
	Media     []struct {
		Type string `json:"type"`
		Src  string `json:"src"`
	} `json:"media"`
}

func (h *Handler) ImportSocialLibraryForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var req importSocialLibraryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	if len(req.Media) == 0 {
		writeError(w, http.StatusBadRequest, "media is required")
		return
	}

	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		provider = "unknown"
	}
	first := req.Media[0]
	contentType := "image"
	for _, m := range req.Media {
		if strings.Contains(strings.ToLower(m.Type), "video") {
			contentType = "video"
			break
		}
	}
	title := strings.TrimSpace(req.Notes)
	if title == "" {
		title = strings.TrimSpace(req.Selection)
	}
	if title == "" {
		if metaMap, ok := req.Meta.(map[string]any); ok {
			if t, ok := metaMap["title"].(string); ok {
				title = strings.TrimSpace(t)
			}
		}
	}

	// Do not persist the page URL in the stored payload; keep only media/meta.
	reqForStorage := req
	reqForStorage.URL = ""
	rawPayload, _ := json.Marshal(reqForStorage)
	hh := sha1.Sum([]byte(req.URL + first.Src + userID))
	hash := hex.EncodeToString(hh[:])
	if len(hash) > 16 {
		hash = hash[:16]
	}
	rowID := fmt.Sprintf("import:%s:%s", userID, hash)
	externalID := rowID

	// Ensure the user row exists to satisfy FK (id only; no-op if already present).
	_, _ = h.db.ExecContext(r.Context(), `
		INSERT INTO public.users (id, email, name)
		VALUES ($1, '', '')
		ON CONFLICT (id) DO NOTHING
	`, userID)

	if _, err := h.db.ExecContext(r.Context(), `
	INSERT INTO public.social_libraries
		  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
		VALUES
		  ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''), NULL, NULL, NULL, $9::jsonb, $10, NOW(), NOW())
		ON CONFLICT (user_id, network, external_id)
		DO UPDATE SET
		  content_type = EXCLUDED.content_type,
		  title = EXCLUDED.title,
		  permalink_url = EXCLUDED.permalink_url,
		  media_url = EXCLUDED.media_url,
		  thumbnail_url = EXCLUDED.thumbnail_url,
		  raw_payload = EXCLUDED.raw_payload,
		  updated_at = NOW()
	`, rowID, userID, provider, contentType, title, "", first.Src, first.Src, string(rawPayload), externalID); err != nil {
		log.Printf("[ImportSocialLibrary] insert failed userId=%s err=%v", userID, err)
		http.Error(w, "failed to save", http.StatusInternalServerError)
		return
	}

	// Also create a local draft post so it surfaces in Drafts.
	draftContent := strings.TrimSpace(req.Notes)
	if draftContent == "" {
		draftContent = strings.TrimSpace(req.Selection)
	}
	if draftContent == "" {
		draftContent = strings.TrimSpace(req.URL)
	}
	if draftContent == "" {
		draftContent = "Imported draft"
	}
	_, _ = h.db.ExecContext(r.Context(), `
		INSERT INTO public.posts (id, team_id, user_id, content, status, providers, media, scheduled_for, published_at, created_at, updated_at)
		VALUES ($1, NULL, $2, $3, 'draft', ARRAY[]::text[], ARRAY[]::text[], NULL, NULL, NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`, rowID, userID, draftContent)

	// Kick off async media import to /media and attach to the draft post.
	mediaURLs := make([]string, 0, len(req.Media))
	for _, m := range req.Media {
		s := strings.TrimSpace(m.Src)
		if s != "" {
			mediaURLs = append(mediaURLs, s)
		}
	}
	if len(mediaURLs) > 0 && h != nil {
		go h.importMediaForDraft(context.Background(), userID, rowID, mediaURLs)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"id": rowID,
	})
}

// DeleteSocialLibrariesForUser deletes cached SocialLibraries rows by id for a given user.
// This is meant for user-initiated cleanup from the Library page.
func (h *Handler) DeleteSocialLibrariesForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	start := time.Now()
	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var req deleteSocialLibrariesRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	ids := make([]string, 0, len(req.IDs))
	seen := map[string]bool{}
	for _, id := range req.IDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		writeError(w, http.StatusBadRequest, "ids is required")
		return
	}
	if len(ids) > 200 {
		writeError(w, http.StatusBadRequest, "too many ids (max 200)")
		return
	}

	log.Printf("[Library][Delete] start userId=%s ids=%d deleteExternal=%t", userID, len(ids), req.DeleteExternal)

	// If requested, attempt to delete from the external provider first, and only remove from our library if that succeeds.
	idsToDeleteLocally := ids
	var extResp *struct {
		Attempted bool `json:"attempted"`
		Deleted   int  `json:"deleted"`
		Failed    []struct {
			ID      string `json:"id"`
			Network string `json:"network"`
			Reason  string `json:"reason"`
		} `json:"failed,omitempty"`
	}
	if req.DeleteExternal {
		extResp = &struct {
			Attempted bool `json:"attempted"`
			Deleted   int  `json:"deleted"`
			Failed    []struct {
				ID      string `json:"id"`
				Network string `json:"network"`
				Reason  string `json:"reason"`
			} `json:"failed,omitempty"`
		}{Attempted: true}

		okIDs := make([]string, 0, len(ids))
		for _, id := range ids {
			// Avoid hanging on DB locks/slow queries.
			ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
			var networkRaw string
			var externalIDRaw sql.NullString
			var permalinkRaw sql.NullString
			err := h.db.QueryRowContext(ctx, `SELECT network, external_id, permalink_url FROM public.social_libraries WHERE user_id=$1 AND id=$2`, userID, id).Scan(&networkRaw, &externalIDRaw, &permalinkRaw)
			cancel()
			if err != nil {
				if err == sql.ErrNoRows {
					extResp.Failed = append(extResp.Failed, struct {
						ID      string `json:"id"`
						Network string `json:"network"`
						Reason  string `json:"reason"`
					}{ID: id, Network: "", Reason: "not_found"})
					continue
				}
				log.Printf("[Library][DeleteExternal] select_one error userId=%s id=%s err=%v", userID, truncate(id, 120), err)
				extResp.Failed = append(extResp.Failed, struct {
					ID      string `json:"id"`
					Network string `json:"network"`
					Reason  string `json:"reason"`
				}{ID: id, Network: "", Reason: "db_error"})
				continue
			}
			network := strings.TrimSpace(strings.ToLower(networkRaw))
			externalID := strings.TrimSpace(externalIDRaw.String)
			permalink := strings.TrimSpace(permalinkRaw.String)
			log.Printf("[Library][DeleteExternal] item userId=%s id=%s network=%s hasExternalId=%t", userID, truncate(id, 80), network, externalID != "")

			if externalID == "" {
				extResp.Failed = append(extResp.Failed, struct {
					ID      string `json:"id"`
					Network string `json:"network"`
					Reason  string `json:"reason"`
				}{ID: id, Network: network, Reason: "missing_external_id"})
				continue
			}

			var derr error
			switch network {
			case "instagram":
				derr = h.deleteInstagramMedia(r.Context(), userID, externalID)
			case "facebook":
				derr = h.deleteFacebookObject(r.Context(), userID, externalID)
			case "pinterest":
				derr = h.deletePinterestPin(r.Context(), userID, externalID)
			case "youtube":
				derr = h.deleteYouTubeVideo(r.Context(), userID, externalID)
			default:
				derr = fmt.Errorf("unsupported_network")
			}
			if derr != nil {
				// Workaround for provider limitations: if Instagram deletion fails, notify the owner with a direct link
				// so they can delete it manually in Instagram.
				if network == "instagram" {
					title := "Manual action required: delete on Instagram"
					body := fmt.Sprintf("We couldn't delete this post via the Instagram API. Please open it and delete it from Instagram. (reason=%s)", truncate(derr.Error(), 220))
					var urlStr *string
					if permalink != "" {
						u := permalink
						urlStr = &u
					}
					b := body
					h.createNotificationOnce(userID, "manual_delete.instagram", title, &b, urlStr)
				}
				extResp.Failed = append(extResp.Failed, struct {
					ID      string `json:"id"`
					Network string `json:"network"`
					Reason  string `json:"reason"`
				}{ID: id, Network: network, Reason: truncate(derr.Error(), 220)})
				continue
			}

			okIDs = append(okIDs, id)
			extResp.Deleted++
		}

		idsToDeleteLocally = okIDs
		log.Printf("[Library][DeleteExternal] done userId=%s reqIds=%d okIds=%d failed=%d dur=%dms", userID, len(ids), len(okIDs), len(extResp.Failed), time.Since(start).Milliseconds())
	}

	if len(idsToDeleteLocally) == 0 {
		// Nothing to remove locally (either everything failed external deletion, or unsupported).
		failedN := 0
		if extResp != nil {
			failedN = len(extResp.Failed)
		}
		log.Printf("[Library][Delete] nothing_to_delete_locally userId=%s deleteExternal=%t extFailed=%d dur=%dms", userID, req.DeleteExternal, failedN, time.Since(start).Milliseconds())
		writeJSON(w, http.StatusOK, deleteSocialLibrariesResponse{OK: true, Deleted: 0, IDs: []string{}, External: extResp})
		return
	}

	ctxDel, cancelDel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancelDel()
	rows, err := h.db.QueryContext(ctxDel, `DELETE FROM public.social_libraries WHERE user_id = $1 AND id = ANY($2) RETURNING id`, userID, pq.Array(idsToDeleteLocally))
	if err != nil {
		log.Printf("[Library][Delete] exec error userId=%s err=%v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	deletedIDs := make([]string, 0, len(idsToDeleteLocally))
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			log.Printf("[Library][Delete] scan error userId=%s err=%v", userID, err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if strings.TrimSpace(id) != "" {
			deletedIDs = append(deletedIDs, id)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[Library][Delete] rows error userId=%s err=%v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Printf("[Library][Delete] ok userId=%s deleted=%d reqIds=%d dur=%dms", userID, len(deletedIDs), len(ids), time.Since(start).Milliseconds())

	// Realtime: notify clients so they can update without polling.
	h.emitEvent(userID, realtimeEvent{
		Type:   "library.deleted",
		UserID: userID,
		IDs:    deletedIDs,
		At:     time.Now().UTC().Format(time.RFC3339),
	})

	writeJSON(w, http.StatusOK, deleteSocialLibrariesResponse{OK: true, Deleted: int64(len(deletedIDs)), IDs: deletedIDs, External: extResp})
}

func (h *Handler) SyncSocialLibrariesForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
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
		UserID     string                    `json:"user_id"`
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
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ListNotificationsForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}
	limit := parseLimit(r, 50, 1, 200)
	if limit <= 0 {
		writeError(w, http.StatusBadRequest, "invalid limit")
		return
	}
	onlyUnread := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("unread"))) == "true"

	q := `
		SELECT id, user_id, type, title, body, url, created_at, read_at
		FROM public.notifications
		WHERE user_id = $1
	`
	args := []any{userID}
	if onlyUnread {
		q += " AND read_at IS NULL"
	}
	q += " ORDER BY created_at DESC LIMIT $2"
	args = append(args, limit)

	rows, err := h.db.Query(q, args...)
	if err != nil {
		log.Printf("[Notifications][List] query error userId=%s err=%v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	out := []notificationRow{}
	for rows.Next() {
		var n notificationRow
		var title sql.NullString
		var body sql.NullString
		var urlStr sql.NullString
		var readAt sql.NullTime
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &title, &body, &urlStr, &n.CreatedAt, &readAt); err != nil {
			log.Printf("[Notifications][List] scan error userId=%s err=%v", userID, err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if title.Valid {
			n.Title = title.String
		}
		if body.Valid {
			b := body.String
			n.Body = &b
		}
		if urlStr.Valid {
			u := urlStr.String
			n.URL = &u
		}
		n.ReadAt = nullTimePtr(readAt)
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[Notifications][List] rows error userId=%s err=%v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) MarkNotificationReadForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	userID := pathVar(r, "userId")
	id := pathVar(r, "id")
	if userID == "" || id == "" {
		writeError(w, http.StatusBadRequest, "userId and id are required")
		return
	}
	res, err := h.db.Exec(`
		UPDATE public.notifications
		   SET read_at = COALESCE(read_at, NOW())
		 WHERE user_id = $1 AND id = $2
	`, userID, id)
	if err != nil {
		log.Printf("[Notifications][Read] exec error userId=%s id=%s err=%v", userID, truncate(id, 80), err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) createNotification(userID, typ, title string, body *string, urlStr *string) string {
	id := fmt.Sprintf("n_%d", time.Now().UTC().UnixNano())
	_, err := h.db.Exec(`
		INSERT INTO public.notifications (id, user_id, type, title, body, url, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`, id, userID, typ, title, body, urlStr)
	if err != nil {
		log.Printf("[Notifications][Create] insert error userId=%s type=%s err=%v", userID, typ, err)
		return ""
	}
	log.Printf("[Notifications][Create] ok userId=%s id=%s type=%s", userID, id, typ)

	// Realtime: notify UI (so it can show a badge/toast).
	h.emitEvent(userID, realtimeEvent{
		Type:   "notification.created",
		UserID: userID,
		IDs:    []string{id},
		Status: typ,
		At:     time.Now().UTC().Format(time.RFC3339),
	})
	return id
}

// createNotificationOnce inserts a notification only if there isn't already an unread one with the same (type,url).
// This prevents flooding the user when a provider consistently fails (ex: Meta delete flakiness).
func (h *Handler) createNotificationOnce(userID, typ, title string, body *string, urlStr *string) string {
	if urlStr != nil && strings.TrimSpace(*urlStr) != "" {
		var existingID string
		err := h.db.QueryRow(`
			SELECT id
			  FROM public.notifications
			 WHERE user_id = $1
			   AND type = $2
			   AND url = $3
			   AND read_at IS NULL
			 ORDER BY created_at DESC
			 LIMIT 1
		`, userID, typ, strings.TrimSpace(*urlStr)).Scan(&existingID)
		if err == nil && strings.TrimSpace(existingID) != "" {
			log.Printf("[Notifications][Create] skip_duplicate userId=%s type=%s existingId=%s", userID, typ, existingID)
			return existingID
		}
	}
	return h.createNotification(userID, typ, title, body, urlStr)
}

// ListPostsForUser returns local posts (draft/scheduled/published) for a given user.
func (h *Handler) ListPostsForUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := strings.TrimSpace(vars["userId"])
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	limit := 200

	posts := []models.Post{}
	var rows *sql.Rows
	var err error
	if status != "" {
		rows, err = h.db.Query(
			`SELECT id, COALESCE(team_id,'') as team_id, user_id, content, status, COALESCE(providers, ARRAY[]::text[]),
			        COALESCE(media, ARRAY[]::text[]),
			        scheduled_for, published_at,
			        last_publish_job_id, last_publish_status, last_publish_error, last_publish_attempt_at,
			        created_at, updated_at
			 FROM public.posts
			 WHERE user_id = $1 AND status = $2
			 ORDER BY created_at DESC
			 LIMIT $3`,
			userID, status, limit,
		)
	} else {
		rows, err = h.db.Query(
			`SELECT id, COALESCE(team_id,'') as team_id, user_id, content, status, COALESCE(providers, ARRAY[]::text[]),
			        COALESCE(media, ARRAY[]::text[]),
			        scheduled_for, published_at,
			        last_publish_job_id, last_publish_status, last_publish_error, last_publish_attempt_at,
			        created_at, updated_at
			 FROM public.posts
			 WHERE user_id = $1
			 ORDER BY created_at DESC
			 LIMIT $2`,
			userID, limit,
		)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var p models.Post
		if err := rows.Scan(
			&p.ID, &p.TeamID, &p.UserID, &p.Content, &p.Status, pq.Array(&p.Providers),
			pq.Array(&p.Media),
			&p.ScheduledFor, &p.PublishedAt,
			&p.LastPublishJobID, &p.LastPublishStatus, &p.LastPublishError, &p.LastPublishAttemptAt,
			&p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		posts = append(posts, p)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, posts)
}

// CreatePostForUser creates a local post for a user (draft/scheduled metadata only).
func (h *Handler) CreatePostForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	userID := strings.TrimSpace(pathVar(r, "userId"))
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var req createOrUpdatePostRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	id := ""
	if req.ID != nil {
		id = strings.TrimSpace(*req.ID)
	}
	if id == "" {
		id = randHex(16)
	}

	status := "draft"
	if req.Status != nil {
		status = strings.TrimSpace(*req.Status)
	}
	if status == "" {
		status = "draft"
	}
	if status != "draft" && status != "scheduled" && status != "published" {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	if status == "scheduled" && req.ScheduledFor == nil {
		writeError(w, http.StatusBadRequest, "scheduledFor is required when status=scheduled")
		return
	}

	// Normalize provider list (trim+lowercase+dedupe) and validate for scheduled posts.
	var providersList []string
	if req.Providers != nil {
		seen := map[string]bool{}
		for _, p := range req.Providers {
			pp := strings.TrimSpace(strings.ToLower(p))
			if pp == "" || seen[pp] {
				continue
			}
			switch pp {
			case "instagram", "tiktok", "facebook", "youtube", "pinterest", "threads":
				seen[pp] = true
				providersList = append(providersList, pp)
			default:
				// ignore unknown providers to keep behavior tolerant
			}
		}
	}
	if status == "scheduled" && len(providersList) == 0 {
		writeError(w, http.StatusBadRequest, "providers is required when status=scheduled")
		return
	}

	// Normalize media rel paths (only accept `/media/...` rel paths) and validate requirements.
	mediaList := make([]string, 0, len(req.Media))
	seenMedia := map[string]bool{}
	for _, m := range req.Media {
		mm := strings.TrimSpace(m)
		if mm == "" || seenMedia[mm] {
			continue
		}
		// Only store rel paths that our backend can serve publicly.
		if !strings.HasPrefix(mm, "/media/") {
			continue
		}
		seenMedia[mm] = true
		mediaList = append(mediaList, mm)
	}
	// Only validate media requirement for providers that strictly require it
	// Facebook and Threads allow text-only posts
	if status == "scheduled" && len(mediaList) == 0 {
		for _, p := range providersList {
			switch p {
			case "instagram", "pinterest", "tiktok", "youtube":
				writeError(w, http.StatusBadRequest, "media is required for the selected provider(s)")
				return
			}
		}
	}

	var out models.Post
	query := `
		INSERT INTO public.posts (id, team_id, user_id, content, status, providers, media, scheduled_for, published_at, created_at, updated_at)
		VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		RETURNING id, COALESCE(team_id,''), user_id, content, status, COALESCE(providers, ARRAY[]::text[]), COALESCE(media, ARRAY[]::text[]),
		          scheduled_for, published_at,
		          last_publish_job_id, last_publish_status, last_publish_error, last_publish_attempt_at,
		          created_at, updated_at
	`
	err := h.db.QueryRow(query, id, userID, req.Content, status, pq.Array(providersList), pq.Array(mediaList), req.ScheduledFor, req.PublishedAt).
		Scan(
			&out.ID, &out.TeamID, &out.UserID, &out.Content, &out.Status, pq.Array(&out.Providers),
			pq.Array(&out.Media),
			&out.ScheduledFor, &out.PublishedAt,
			&out.LastPublishJobID, &out.LastPublishStatus, &out.LastPublishError, &out.LastPublishAttemptAt,
			&out.CreatedAt, &out.UpdatedAt,
		)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, out)
}

// UpdatePostForUser updates a local post for a given user.
func (h *Handler) UpdatePostForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPut) {
		return
	}

	userID := strings.TrimSpace(pathVar(r, "userId"))
	postID := strings.TrimSpace(pathVar(r, "postId"))
	if userID == "" || postID == "" {
		writeError(w, http.StatusBadRequest, "userId and postId are required")
		return
	}

	var req createOrUpdatePostRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	if req.Status != nil {
		s := strings.TrimSpace(*req.Status)
		if s == "" {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
		if s != "draft" && s != "scheduled" && s != "published" {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
		if s == "scheduled" && req.ScheduledFor == nil {
			writeError(w, http.StatusBadRequest, "scheduledFor is required when status=scheduled")
			return
		}
	}

	// Normalize provider list (trim+lowercase+dedupe). If field omitted, keep nil to represent "no change".
	var providersArg interface{} = nil
	if req.Providers != nil {
		next := make([]string, 0, len(req.Providers))
		seen := map[string]bool{}
		for _, p := range req.Providers {
			pp := strings.TrimSpace(strings.ToLower(p))
			if pp == "" || seen[pp] {
				continue
			}
			switch pp {
			case "instagram", "tiktok", "facebook", "youtube", "pinterest", "threads":
				seen[pp] = true
				next = append(next, pp)
			default:
				// ignore unknown providers
			}
		}
		providersArg = pq.Array(next)
	}

	// Normalize media rel paths. If field omitted, keep nil to represent "no change".
	var mediaArg interface{} = nil
	if req.Media != nil {
		next := make([]string, 0, len(req.Media))
		seen := map[string]bool{}
		for _, m := range req.Media {
			mm := strings.TrimSpace(m)
			if mm == "" || seen[mm] {
				continue
			}
			if !strings.HasPrefix(mm, "/media/") {
				continue
			}
			seen[mm] = true
			next = append(next, mm)
		}
		mediaArg = pq.Array(next)
	}

	var out models.Post
	clearPublishState := req.Content != nil || req.Status != nil || req.ScheduledFor != nil || req.Providers != nil || req.Media != nil
	query := `
		UPDATE public.posts
		SET
			content = COALESCE($3, content),
			status = COALESCE($4, status),
			scheduled_for = COALESCE($5, scheduled_for),
			published_at = COALESCE($6, published_at),
			providers = COALESCE($7::text[], providers),
			media = COALESCE($8::text[], media),
			last_publish_job_id = CASE WHEN $9 THEN NULL ELSE last_publish_job_id END,
			last_publish_status = CASE WHEN $9 THEN NULL ELSE last_publish_status END,
			last_publish_error = CASE WHEN $9 THEN NULL ELSE last_publish_error END,
			last_publish_attempt_at = CASE WHEN $9 THEN NULL ELSE last_publish_attempt_at END,
			updated_at = NOW()
		WHERE id = $1 AND user_id = $2
		RETURNING id, COALESCE(team_id,''), user_id, content, status, COALESCE(providers, ARRAY[]::text[]), COALESCE(media, ARRAY[]::text[]),
		          scheduled_for, published_at,
		          last_publish_job_id, last_publish_status, last_publish_error, last_publish_attempt_at,
		          created_at, updated_at
	`
	err := h.db.QueryRow(query, postID, userID, req.Content, req.Status, req.ScheduledFor, req.PublishedAt, providersArg, mediaArg, clearPublishState).
		Scan(
			&out.ID, &out.TeamID, &out.UserID, &out.Content, &out.Status, pq.Array(&out.Providers),
			pq.Array(&out.Media),
			&out.ScheduledFor, &out.PublishedAt,
			&out.LastPublishJobID, &out.LastPublishStatus, &out.LastPublishError, &out.LastPublishAttemptAt,
			&out.CreatedAt, &out.UpdatedAt,
		)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, out)
}

// DeletePostForUser deletes a local post for a given user.
func (h *Handler) DeletePostForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodDelete) {
		return
	}

	userID := strings.TrimSpace(pathVar(r, "userId"))
	postID := strings.TrimSpace(pathVar(r, "postId"))
	if userID == "" || postID == "" {
		writeError(w, http.StatusBadRequest, "userId and postId are required")
		return
	}

	res, err := h.db.Exec(`DELETE FROM public.posts WHERE id = $1 AND user_id = $2`, postID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// publishScheduledPostNowOnce claims a single scheduled post and enqueues a PublishJob for immediate processing.
// The caller provides startJob to actually execute the job (e.g., in a goroutine calling runPublishJob).
func (h *Handler) publishScheduledPostNowOnce(ctx context.Context, origin, postID, userID string, startJob startPublishJobFunc) (string, error) {
	if h == nil || h.db == nil {
		return "", fmt.Errorf("db is nil")
	}
	if strings.TrimSpace(postID) == "" || strings.TrimSpace(userID) == "" {
		return "", fmt.Errorf("postId and userId are required")
	}
	if strings.TrimSpace(origin) == "" {
		origin = "http://localhost"
	}
	if startJob == nil {
		startJob = func(jobID, userID, caption string, providers []string, relMedia []string) {}
	}

	jobID := fmt.Sprintf("pub_%s", randHex(12))

	// Claim atomically and pull the required fields in one round trip.
	var (
		content         sql.NullString
		providers       []string
		media           []string
		newScheduledFor time.Time
	)
	err := h.db.QueryRowContext(ctx, `
		UPDATE public.posts
		   SET scheduled_for = NOW(),
		       last_publish_job_id = $3,
		       last_publish_status = 'queued',
		       last_publish_error = NULL,
		       last_publish_attempt_at = NOW(),
		       updated_at = NOW()
		 WHERE id = $1
		   AND user_id = $2
		   AND status = 'scheduled'
		   AND published_at IS NULL
		   AND last_publish_job_id IS NULL
		RETURNING content, COALESCE(providers, ARRAY[]::text[]), COALESCE(media, ARRAY[]::text[]), scheduled_for
	`, postID, userID, jobID).Scan(&content, pq.Array(&providers), pq.Array(&media), &newScheduledFor)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", sql.ErrNoRows
		}
		return "", err
	}

	caption := strings.TrimSpace(content.String)
	if caption == "" {
		// Don't enqueue a publish job; mark as failed so user can edit & retry.
		_, _ = h.db.ExecContext(ctx, `
			UPDATE public.posts
			   SET last_publish_status='failed',
			       last_publish_error='empty_content',
			       updated_at=NOW()
			 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
		`, postID, userID, jobID)
		return "", fmt.Errorf("empty_content")
	}
	if len(providers) == 0 {
		_, _ = h.db.ExecContext(ctx, `
			UPDATE public.posts
			   SET last_publish_status='failed',
			       last_publish_error='missing_providers',
			       updated_at=NOW()
			 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
		`, postID, userID, jobID)
		return "", fmt.Errorf("missing_providers")
	}
	if len(media) == 0 {
		for _, p := range providers {
			switch p {
			case "instagram", "pinterest", "tiktok", "youtube":
				_, _ = h.db.ExecContext(ctx, `
					UPDATE public.posts
					   SET last_publish_status='failed',
					       last_publish_error='missing_media',
					       updated_at=NOW()
					 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
				`, postID, userID, jobID)
				return "", fmt.Errorf("missing_media")
			}
		}
	}

	reqSnapshot := map[string]interface{}{
		"source":       "manual_publish_now",
		"postId":       postID,
		"userId":       userID,
		"providers":    providers,
		"media":        media,
		"scheduledFor": newScheduledFor.UTC().Format(time.RFC3339),
		"publicOrigin": origin,
	}
	reqJSON, _ := json.Marshal(reqSnapshot)
	now := time.Now()

	_, err = h.db.ExecContext(ctx, `
		INSERT INTO public.publish_jobs
		  (id, user_id, status, providers, caption, request_json, created_at, updated_at)
		VALUES
		  ($1, $2, 'queued', $3, $4, $5::jsonb, $6, $6)
	`, jobID, userID, pq.Array(providers), caption, string(reqJSON), now)
	if err != nil {
		// Undo claim so it can be retried
		_, _ = h.db.ExecContext(ctx, `
			UPDATE public.posts
			   SET last_publish_job_id=NULL,
			       last_publish_status=NULL,
			       last_publish_error=$4,
			       last_publish_attempt_at=NULL,
			       updated_at=NOW()
			 WHERE id=$1 AND user_id=$2 AND last_publish_job_id=$3
		`, postID, userID, jobID, truncate(err.Error(), 300))
		return "", err
	}

	startJob(jobID, userID, caption, providers, media)
	return jobID, nil
}

// PublishNowPostForUser enqueues a scheduled post for immediate publishing.
// Intended for dev/testing to avoid waiting for the scheduled-post poller interval.
func (h *Handler) PublishNowPostForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	userID := strings.TrimSpace(pathVar(r, "userId"))
	postID := strings.TrimSpace(pathVar(r, "postId"))
	if userID == "" || postID == "" {
		writeError(w, http.StatusBadRequest, "userId and postId are required")
		return
	}

	origin := publicOrigin(r)
	log.Printf("[PublishNow] request userId=%s postId=%s origin=%s", userID, postID, origin)
	jobID, err := h.publishScheduledPostNowOnce(r.Context(), origin, postID, userID, func(jobID, userID, caption string, providers []string, relMedia []string) {
		go h.runPublishJob(jobID, userID, caption, publishPostRequest{Providers: providers}, relMedia, origin)
	})
	if err != nil {
		if err == sql.ErrNoRows {
			// Determine whether it's a missing row vs a conflict (already published/claimed/not scheduled)
			var status string
			var lastJob sql.NullString
			var publishedAt sql.NullTime
			e2 := h.db.QueryRowContext(r.Context(), `SELECT status, last_publish_job_id, published_at FROM public.posts WHERE id=$1 AND user_id=$2`, postID, userID).
				Scan(&status, &lastJob, &publishedAt)
			if e2 == sql.ErrNoRows {
				writeError(w, http.StatusNotFound, "not found")
				return
			}
			if e2 == nil {
				if publishedAt.Valid {
					writeError(w, http.StatusConflict, "already_published")
					return
				}
				if lastJob.Valid && strings.TrimSpace(lastJob.String) != "" {
					writeError(w, http.StatusConflict, "already_queued")
					return
				}
				if strings.TrimSpace(status) != "scheduled" {
					writeError(w, http.StatusBadRequest, "not_scheduled")
					return
				}
			}
			writeError(w, http.StatusConflict, "not_publishable")
			return
		}
		if strings.Contains(err.Error(), "empty_content") {
			writeError(w, http.StatusBadRequest, "empty_content")
			return
		}
		if strings.Contains(err.Error(), "missing_providers") {
			writeError(w, http.StatusBadRequest, "missing_providers")
			return
		}
		if strings.Contains(err.Error(), "missing_media") {
			writeError(w, http.StatusBadRequest, "missing_media")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "jobId": jobID, "status": "queued"})
}

func uploadKind(contentType string, filename string) string {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if strings.HasPrefix(ct, "image/") {
		return "image"
	}
	if strings.HasPrefix(ct, "video/") {
		return "video"
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext != "" {
		if byExt := mime.TypeByExtension(ext); byExt != "" {
			byExt = strings.ToLower(byExt)
			if strings.HasPrefix(byExt, "image/") {
				return "image"
			}
			if strings.HasPrefix(byExt, "video/") {
				return "video"
			}
		}
	}
	return "other"
}

// ListUploadsForUser lists files for a user for use as local draft media.
// Files are stored under `media/<hmac(userId)>/<shard>/<hmac(filename)>.ext` and served publicly at `/media/...`.
func (h *Handler) ListUploadsForUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := strings.TrimSpace(vars["userId"])
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	userHash := mediaUserHash(userID)
	baseDir := filepath.Join("media", userHash)
	shards, err := os.ReadDir(baseDir)
	if err != nil {
		// If directory doesn't exist yet, return empty list.
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, uploadsListResponse{OK: true, Items: []uploadItem{}})
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	items := make([]uploadItem, 0, 64)
	for _, shard := range shards {
		if shard == nil || !shard.IsDir() {
			continue
		}
		shardName := strings.TrimSpace(shard.Name())
		if shardName == "" {
			continue
		}
		dir := filepath.Join(baseDir, shardName)
		files, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range files {
			if e == nil || e.IsDir() {
				continue
			}
			fn := strings.TrimSpace(e.Name())
			if fn == "" {
				continue
			}
			ext := strings.ToLower(filepath.Ext(fn))
			ct := ""
			if ext != "" {
				ct = mime.TypeByExtension(ext)
			}
			kind := uploadKind(ct, fn)
			size := 0
			if info, err := e.Info(); err == nil {
				if info.Size() > 0 && info.Size() < 1<<31 {
					size = int(info.Size())
				}
			}
			items = append(items, uploadItem{
				ID:          fn, // stable identifier used for delete selection
				Filename:    fn,
				URL:         fmt.Sprintf("/media/%s/%s/%s", userHash, shardName, fn),
				ContentType: ct,
				Size:        size,
				Kind:        kind,
			})
		}
	}

	// Keep stable-ish ordering for UI (by filename which includes a randomish hash).
	sort.Slice(items, func(i, j int) bool { return items[i].Filename < items[j].Filename })
	writeJSON(w, http.StatusOK, uploadsListResponse{OK: true, Items: items})
}

// UploadUploadsForUser accepts multipart files and stores them under `media/<hmac(userId)>/...`.
// Field name supported: files (preferred) or media (fallback).
func (h *Handler) UploadUploadsForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	userID := strings.TrimSpace(pathVar(r, "userId"))
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	ct := r.Header.Get("Content-Type")
	if !strings.Contains(ct, "multipart/form-data") {
		writeError(w, http.StatusBadRequest, "expected multipart/form-data")
		return
	}

	// 50MB total parsing limit.
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if r.MultipartForm == nil || r.MultipartForm.File == nil {
		writeError(w, http.StatusBadRequest, "missing files")
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		files = r.MultipartForm.File["media"]
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "missing files")
		return
	}
	if len(files) > 30 {
		writeError(w, http.StatusBadRequest, "too many files (max 30)")
		return
	}

	media := make([]uploadedMedia, 0, len(files))
	orig := make([]map[string]any, 0, len(files))
	const maxPerFile = 25 << 20 // 25MB per file
	for _, fh := range files {
		if fh == nil {
			continue
		}
		f, err := fh.Open()
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		b, err := io.ReadAll(io.LimitReader(f, maxPerFile+1))
		_ = f.Close()
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(b) > maxPerFile {
			writeError(w, http.StatusBadRequest, "file too large (max 25MB per file)")
			return
		}
		contentType := strings.TrimSpace(fh.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = http.DetectContentType(b)
		}
		media = append(media, uploadedMedia{Filename: fh.Filename, ContentType: contentType, Bytes: b})
		orig = append(orig, map[string]any{"name": fh.Filename, "contentType": contentType, "size": len(b)})
	}

	rel, _, err := saveUploadedMedia(userID, media)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	items := make([]uploadItem, 0, len(rel))
	for i, p := range rel {
		fn := filepath.Base(p)
		info := orig[min(i, len(orig)-1)]
		ctype, _ := info["contentType"].(string)
		szAny := info["size"]
		sz := 0
		if n, ok := szAny.(int); ok {
			sz = n
		}
		items = append(items, uploadItem{
			ID:          fn,
			Filename:    fn,
			URL:         p,
			ContentType: ctype,
			Size:        sz,
			Kind:        uploadKind(ctype, fn),
		})
	}

	writeJSON(w, http.StatusOK, uploadsUploadResponse{OK: true, Items: items})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// DeleteUploadsForUser deletes uploaded files by id (hashed filename) under `media/<hmac(userId)>/...`.
// Back-compat: also attempts deletion under the legacy directory `media/uploads/<userId>/`.
func (h *Handler) DeleteUploadsForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	userID := strings.TrimSpace(pathVar(r, "userId"))
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var req deleteUploadsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	seen := map[string]bool{}
	ids := make([]string, 0, len(req.IDs))
	for _, id := range req.IDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		// Disallow any path separators / traversal.
		if id != filepath.Base(id) || strings.Contains(id, "..") || strings.Contains(id, "/") || strings.Contains(id, "\\") {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		writeError(w, http.StatusBadRequest, "ids is required")
		return
	}
	if len(ids) > 200 {
		writeError(w, http.StatusBadRequest, "too many ids (max 200)")
		return
	}

	var deleted int64 = 0

	// New hashed layout
	userHash := mediaUserHash(userID)
	baseDir := filepath.Join("media", userHash)
	known := map[string]string{} // filename -> absolute path
	if shards, err := os.ReadDir(baseDir); err == nil {
		for _, shard := range shards {
			if shard == nil || !shard.IsDir() {
				continue
			}
			shardName := strings.TrimSpace(shard.Name())
			if shardName == "" {
				continue
			}
			dir := filepath.Join(baseDir, shardName)
			files, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			for _, f := range files {
				if f == nil || f.IsDir() {
					continue
				}
				fn := strings.TrimSpace(f.Name())
				if fn == "" {
					continue
				}
				// Only map the specific ids requested (keeps scan cheap).
				if seen[fn] {
					known[fn] = filepath.Join(dir, fn)
				}
			}
		}
	}
	for _, id := range ids {
		if p := known[id]; p != "" {
			if err := os.Remove(p); err == nil {
				deleted++
			}
		}
	}

	// Legacy layout fall-back
	legacyDir := filepath.Join("media", "uploads", userID)
	for _, id := range ids {
		path := filepath.Join(legacyDir, id)
		clean := filepath.Clean(path)
		if !strings.HasPrefix(clean, filepath.Clean(legacyDir)+string(filepath.Separator)) {
			continue
		}
		if err := os.Remove(clean); err == nil {
			deleted++
		}
	}

	writeJSON(w, http.StatusOK, deleteUploadsResponse{OK: true, Deleted: deleted})
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
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	req, mediaFiles, err := parsePublishPostRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	caption := strings.TrimSpace(req.Caption)
	if caption == "" {
		writeError(w, http.StatusBadRequest, "caption is required")
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
	writeJSON(w, http.StatusOK, resp)
}

// EnqueuePublishJobForUser enqueues a publishing job and returns immediately.
// The background job will execute the publishing fan-out and persist results back to Postgres.
func (h *Handler) EnqueuePublishJobForUser(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	reqObj, mediaFiles, err := parsePublishPostRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	caption := strings.TrimSpace(reqObj.Caption)
	if caption == "" {
		writeError(w, http.StatusBadRequest, "caption is required")
		return
	}
	caption = strings.ReplaceAll(caption, "\x00", "")
	if !utf8.ValidString(caption) {
		caption = strings.ToValidUTF8(caption, "�")
	}

	// Store uploaded media immediately so the background job can reference it.
	relMedia, saveDetails, err := saveUploadedMedia(userID, mediaFiles)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
		INSERT INTO public.publish_jobs
		  (id, user_id, status, providers, caption, request_json, created_at, updated_at)
		VALUES
		  ($1, $2, 'queued', $3, $4, $5::jsonb, $6, $6)
	`, jobID, userID, pq.Array(reqObj.Providers), caption, string(reqJSON), now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	log.Printf("[PublishJob] enqueued jobId=%s userId=%s providers=%v media=%d dryRun=%v origin=%s",
		jobID, userID, reqObj.Providers, len(relMedia), reqObj.DryRun, publicOrigin(r))

	// Fire and forget: run in background (uses DB for status, so any instance can serve status reads).
	go h.runPublishJob(jobID, userID, caption, reqObj, relMedia, publicOrigin(r))

	resp := map[string]interface{}{
		"ok":     true,
		"jobId":  jobID,
		"status": "queued",
		"saved":  saveDetails["saved"],
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetPublishJob returns the current job status + result (if finished).
func (h *Handler) GetPublishJob(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	jobID := pathVar(r, "jobId")
	if strings.TrimSpace(jobID) == "" {
		writeError(w, http.StatusBadRequest, "jobId is required")
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
		  FROM public.publish_jobs
		 WHERE id = $1
	`, jobID)
	if err := row.Scan(&userID, &status, pq.Array(&providers), &caption, &reqJSON, &resJSON, &errText, &createdAt, &startedAt, &finishedAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "not_found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	resp := map[string]interface{}{
		"ok":         true,
		"id":         jobID,
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

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) runPublishJob(jobID, userID, caption string, req publishPostRequest, relMedia []string, origin string) {
	start := time.Now()
	// If this job is tied to a scheduled/manual publish-now post, fetch its id for better logging.
	postID := ""
	postStatus := ""
	var postScheduledFor sql.NullTime
	postScheduledForStr := ""
	{
		var pid sql.NullString
		var st sql.NullString
		// Best-effort only; do not block job execution on logging.
		_ = h.db.QueryRow(`
			SELECT id, status, scheduled_for
			  FROM public.posts
			 WHERE last_publish_job_id=$1
			 LIMIT 1
		`, jobID).Scan(&pid, &st, &postScheduledFor)
		if pid.Valid {
			postID = strings.TrimSpace(pid.String)
		}
		if st.Valid {
			postStatus = strings.TrimSpace(st.String)
		}
		if postScheduledFor.Valid {
			postScheduledForStr = postScheduledFor.Time.UTC().Format(time.RFC3339)
		}
	}

	log.Printf("[PublishJob] start jobId=%s userId=%s postId=%s postStatus=%s scheduledFor=%s providers=%v relMedia=%d dryRun=%v origin=%s",
		jobID, userID, postID, postStatus, postScheduledForStr, req.Providers, len(relMedia), req.DryRun, origin)
	defer func() {
		if rec := recover(); rec != nil {
			msg := fmt.Sprintf("panic: %v", rec)
			log.Printf("[PublishJob] panic jobId=%s userId=%s err=%s\n%s", jobID, userID, msg, string(debug.Stack()))
			_, _ = h.db.Exec(`
				UPDATE public.publish_jobs
				   SET status='failed', error=$2, finished_at=NOW(), updated_at=NOW()
				 WHERE id=$1
			`, jobID, msg)
			// Best-effort: if this was triggered by a scheduled post, mark it as failed too.
			_, _ = h.db.Exec(`
				UPDATE public.posts
				   SET last_publish_status='failed',
				       last_publish_error=$2,
				       updated_at=NOW()
				 WHERE last_publish_job_id=$1
			`, jobID, truncate(msg, 400))
		}
	}()

	_, _ = h.db.Exec(`
		UPDATE public.publish_jobs
		   SET status='running', started_at=NOW(), updated_at=NOW()
		 WHERE id=$1
	`, jobID)
	// If this is tied to a scheduled post, reflect job state there too.
	_, _ = h.db.Exec(`
		UPDATE public.posts
		   SET last_publish_status='running',
		       updated_at=NOW()
		 WHERE last_publish_job_id=$1
	`, jobID)

	// Realtime: let the UI know we're actively processing.
	if strings.TrimSpace(postID) != "" {
		h.emitEvent(userID, realtimeEvent{
			Type:   "post.updated",
			PostID: postID,
			JobID:  jobID,
			Status: "running",
			At:     time.Now().UTC().Format(time.RFC3339),
		})
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
			log.Printf("[PublishJob] media_load_failed jobId=%s userId=%s postId=%s err=%s", jobID, userID, postID, truncate(err.Error(), 400))
		} else {
			mediaFiles = mf
			log.Printf("[PublishJob] media_loaded jobId=%s userId=%s postId=%s files=%d", jobID, userID, postID, len(mediaFiles))
		}
	}

	// Facebook
	if want["facebook"] {
		log.Printf("[PublishJob] provider_start jobId=%s userId=%s postId=%s provider=facebook pages=%d", jobID, userID, postID, len(req.FacebookPageIDs))
		posted, err, details := h.publishFacebookPages(context.Background(), userID, caption, req.FacebookPageIDs, mediaFiles, req.DryRun)
		if err != nil {
			results["facebook"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
			log.Printf("[PublishJob] provider_failed jobId=%s userId=%s postId=%s provider=facebook posted=%v err=%s", jobID, userID, postID, posted, truncate(err.Error(), 400))
		} else {
			results["facebook"] = publishProviderResult{OK: true, Posted: posted, Details: details}
			log.Printf("[PublishJob] provider_ok jobId=%s userId=%s postId=%s provider=facebook posted=%v", jobID, userID, postID, posted)
		}
	}

	// Instagram (requires public image URLs)
	if want["instagram"] {
		log.Printf("[PublishJob] provider_start jobId=%s userId=%s postId=%s provider=instagram images=%d origin=%s", jobID, userID, postID, len(relMedia), origin)
		imageURLs := make([]string, 0, len(relMedia))
		for _, u := range relMedia {
			imageURLs = append(imageURLs, strings.TrimRight(origin, "/")+u)
		}
		posted, err, details := h.publishInstagramWithImageURLs(context.Background(), userID, caption, imageURLs, req.DryRun)
		if err != nil {
			results["instagram"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
			log.Printf("[PublishJob] provider_failed jobId=%s userId=%s postId=%s provider=instagram posted=%v err=%s", jobID, userID, postID, posted, truncate(err.Error(), 400))
		} else {
			results["instagram"] = publishProviderResult{OK: true, Posted: posted, Details: details}
			log.Printf("[PublishJob] provider_ok jobId=%s userId=%s postId=%s provider=instagram posted=%v", jobID, userID, postID, posted)
		}
	}

	// TikTok (requires a public video URL)
	if want["tiktok"] {
		videoURL := ""
		for i, rel := range relMedia {
			ct := ""
			if i < len(mediaFiles) {
				ct = strings.ToLower(strings.TrimSpace(mediaFiles[i].ContentType))
			}
			if strings.HasPrefix(ct, "video/") || strings.HasSuffix(strings.ToLower(rel), ".mp4") || strings.HasSuffix(strings.ToLower(rel), ".mov") || strings.HasSuffix(strings.ToLower(rel), ".webm") {
				videoURL = strings.TrimRight(origin, "/") + rel
				break
			}
		}
		posted, err, details := h.publishTikTokWithVideoURL(context.Background(), userID, caption, videoURL, req.DryRun)
		if err != nil {
			results["tiktok"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
			log.Printf("[PublishJob] provider_failed jobId=%s userId=%s postId=%s provider=tiktok posted=%v err=%s", jobID, userID, postID, posted, truncate(err.Error(), 400))
		} else {
			results["tiktok"] = publishProviderResult{OK: true, Posted: posted, Details: details}
			log.Printf("[PublishJob] provider_ok jobId=%s userId=%s postId=%s provider=tiktok posted=%v", jobID, userID, postID, posted)
		}
	}

	// YouTube (requires a video upload; currently supports small uploads due to request size limits)
	if want["youtube"] {
		received := make([]map[string]interface{}, 0, len(mediaFiles))
		for i := range mediaFiles {
			received = append(received, map[string]interface{}{
				"filename":    mediaFiles[i].Filename,
				"contentType": mediaFiles[i].ContentType,
				"size":        len(mediaFiles[i].Bytes),
			})
		}
		var video uploadedMedia
		found := false
		for i := range mediaFiles {
			ct := strings.ToLower(strings.TrimSpace(mediaFiles[i].ContentType))
			if semi := strings.Index(ct, ";"); semi >= 0 {
				ct = strings.TrimSpace(ct[:semi])
			}
			fn := strings.ToLower(strings.TrimSpace(mediaFiles[i].Filename))
			if strings.HasPrefix(ct, "video/") ||
				strings.HasSuffix(fn, ".mp4") ||
				strings.HasSuffix(fn, ".mov") ||
				strings.HasSuffix(fn, ".webm") ||
				strings.HasSuffix(fn, ".m4v") ||
				strings.HasSuffix(fn, ".avi") ||
				strings.HasSuffix(fn, ".mkv") {
				video = mediaFiles[i]
				found = true
				break
			}
		}
		if !found {
			results["youtube"] = publishProviderResult{
				OK:      false,
				Error:   "youtube_requires_video",
				Details: map[string]interface{}{"received": received},
			}
			overallOK = false
		} else {
			posted, err, details := h.publishYouTubeWithVideoBytes(context.Background(), userID, caption, video, req.DryRun)
			if err != nil {
				results["youtube"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
				overallOK = false
			} else {
				results["youtube"] = publishProviderResult{OK: true, Posted: posted, Details: details}
			}
		}
	}

	// Pinterest (requires a public image URL)
	if want["pinterest"] {
		imageURL := ""
		for i, rel := range relMedia {
			ct := ""
			fn := ""
			if i < len(mediaFiles) {
				ct = strings.ToLower(strings.TrimSpace(mediaFiles[i].ContentType))
				fn = strings.ToLower(strings.TrimSpace(mediaFiles[i].Filename))
			}
			if strings.Contains(ct, "multipart/") || strings.Contains(ct, "application/") {
				// ignore
			}
			if strings.HasPrefix(ct, "image/") ||
				strings.HasSuffix(strings.ToLower(rel), ".jpg") ||
				strings.HasSuffix(strings.ToLower(rel), ".jpeg") ||
				strings.HasSuffix(strings.ToLower(rel), ".png") ||
				strings.HasSuffix(strings.ToLower(rel), ".webp") ||
				strings.HasSuffix(strings.ToLower(rel), ".gif") ||
				strings.HasSuffix(fn, ".jpg") || strings.HasSuffix(fn, ".jpeg") || strings.HasSuffix(fn, ".png") || strings.HasSuffix(fn, ".webp") || strings.HasSuffix(fn, ".gif") {
				imageURL = strings.TrimRight(origin, "/") + rel
				break
			}
		}
		posted, err, details := h.publishPinterestWithImageURL(context.Background(), userID, caption, imageURL, req.DryRun)
		if err != nil {
			results["pinterest"] = publishProviderResult{OK: false, Posted: posted, Error: err.Error(), Details: details}
			overallOK = false
			detJSON, _ := json.Marshal(details)
			log.Printf("[PublishJob] provider_failed jobId=%s userId=%s postId=%s provider=pinterest posted=%v err=%s details=%s",
				jobID, userID, postID, posted, truncate(err.Error(), 400), truncate(string(detJSON), 1600))
		} else {
			results["pinterest"] = publishProviderResult{OK: true, Posted: posted, Details: details}
			log.Printf("[PublishJob] provider_ok jobId=%s userId=%s postId=%s provider=pinterest posted=%v", jobID, userID, postID, posted)
		}
	}

	for _, p := range []string{"threads"} {
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
		UPDATE public.publish_jobs
		   SET status=$2, result_json=$3::jsonb, error=COALESCE($4, error), finished_at=NOW(), updated_at=NOW()
		 WHERE id=$1
	`, jobID, finalStatus, string(resJSON), errText)

	// If this job was spawned by a scheduled post, update that post's publish tracking and mark it published on success.
	postErr := ""
	if !overallOK {
		postErr = "one_or_more_providers_failed"
	}
	_, _ = h.db.Exec(`
		UPDATE public.posts
		   SET last_publish_status=$2,
		       last_publish_error=CASE WHEN $2='failed' THEN $3 ELSE NULL END,
		       status=CASE WHEN $2='completed' THEN 'published' ELSE status END,
		       published_at=CASE WHEN $2='completed' THEN NOW() ELSE published_at END,
		       updated_at=NOW()
		 WHERE last_publish_job_id=$1
	`, jobID, finalStatus, postErr)

	// Summarize failures (no provider details to avoid leaking sensitive payloads).
	failures := make([]string, 0, 6)
	for prov, rr := range results {
		if !rr.OK {
			msg := rr.Error
			if strings.TrimSpace(msg) == "" {
				msg = "failed"
			}
			failures = append(failures, fmt.Sprintf("%s:%s", prov, truncate(msg, 160)))
		}
	}
	sort.Strings(failures)
	log.Printf("[PublishJob] done jobId=%s userId=%s postId=%s status=%s dur=%dms failures=%v", jobID, userID, postID, finalStatus, time.Since(start).Milliseconds(), failures)

	// Realtime notification (proxied to frontend via Worker WS).
	if strings.TrimSpace(postID) != "" {
		h.emitEvent(userID, realtimeEvent{
			Type:   "post.publish",
			PostID: postID,
			JobID:  jobID,
			Status: finalStatus,
			At:     time.Now().UTC().Format(time.RFC3339),
		})
	}
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

func parseLimit(r *http.Request, def, min, max int) int {
	raw := strings.TrimSpace(r.URL.Query().Get("limit"))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return -1
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

type uploadedMedia struct {
	Filename    string
	ContentType string
	Bytes       []byte
}

var reSafeFilename = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

var (
	mediaHMACSecretOnce sync.Once
	mediaHMACSecret     []byte
)

func getMediaHMACSecret() []byte {
	mediaHMACSecretOnce.Do(func() {
		// NOTE: production should set MEDIA_URL_HMAC_SECRET to a strong random value (e.g. from Jenkins secrets).
		// For local dev we fall back to a fixed value to keep URLs stable across restarts.
		sec := strings.TrimSpace(os.Getenv("MEDIA_URL_HMAC_SECRET"))
		if sec == "" {
			sec = "dev-insecure-media-secret"
			log.Printf("[Media] WARNING: MEDIA_URL_HMAC_SECRET is not set; using a dev default (do not use in production)")
		}
		mediaHMACSecret = []byte(sec)
	})
	return mediaHMACSecret
}

func hmacSHA256Hex(key []byte, msg string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(msg))
	return hex.EncodeToString(mac.Sum(nil))
}

func mediaUserHash(userID string) string {
	userID = strings.TrimSpace(userID)
	return hmacSHA256Hex(getMediaHMACSecret(), "user:"+userID)
}

func sanitizeFilename(base string) string {
	base = filepath.Base(strings.TrimSpace(base))
	base = strings.Trim(base, ".")
	if base == "" {
		base = randHex(12)
	}
	return base
}

func (h *Handler) importMediaForDraft(ctx context.Context, userID, postID string, urls []string) {
	if h == nil || h.db == nil {
		return
	}
	log.Printf("[ImportMedia][%s] start user=%s urls=%d", postID, userID, len(urls))
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	client := &http.Client{Timeout: 20 * time.Second}
	userHash := mediaUserHash(userID)
	baseDir := filepath.Join("media", userHash, "imports")
	_ = os.MkdirAll(baseDir, 0o755)

	relPaths := make([]string, 0, len(urls))
	for i, raw := range urls {
		select {
		case <-ctx.Done():
			log.Printf("[ImportMedia][%s] cancelled: %v", postID, ctx.Err())
			return
		default:
		}
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		log.Printf("[ImportMedia][%s] fetch idx=%d url=%s", postID, i, raw)
		req, err := http.NewRequestWithContext(ctx, "GET", raw, nil)
		if err != nil {
			log.Printf("[ImportMedia][%s] bad_url url=%s err=%v", postID, raw, err)
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[ImportMedia][%s] fetch_failed url=%s err=%v", postID, raw, err)
			continue
		}
		if resp.Body != nil {
			defer resp.Body.Close()
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			log.Printf("[ImportMedia][%s] non_2xx url=%s status=%d", postID, raw, resp.StatusCode)
			continue
		}
		clHeader := strings.TrimSpace(resp.Header.Get("Content-Length"))
		ct := strings.TrimSpace(resp.Header.Get("Content-Type"))
		log.Printf("[ImportMedia][%s] response url=%s status=%d content_type=%q content_length=%q", postID, raw, resp.StatusCode, ct, clHeader)
		// Limit size to 25MB.
		const maxSize = 25 << 20
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxSize+1))
		if err != nil {
			log.Printf("[ImportMedia][%s] read_failed url=%s err=%v", postID, raw, err)
			continue
		}
		if len(data) > maxSize {
			log.Printf("[ImportMedia][%s] skipped url=%s reason=too_large bytes=%d", postID, raw, len(data))
			continue
		}

		fnBase := sanitizeFilename(fmt.Sprintf("%d_%s", i, filepath.Base(raw)))
		ext := extForUpload(fnBase, ct)
		fn := fmt.Sprintf("%s%s", randHex(8), ext)
		path := filepath.Join(baseDir, fn)
		if err := os.WriteFile(path, data, 0o644); err != nil {
			log.Printf("[ImportMedia][%s] write_failed url=%s err=%v", postID, raw, err)
			continue
		}
		rel := fmt.Sprintf("/media/%s/imports/%s", userHash, fn)
		relPaths = append(relPaths, rel)
		log.Printf("[ImportMedia][%s] saved url=%s rel=%s bytes=%d ext=%s content_type=%q", postID, raw, rel, len(data), ext, ct)
	}

	if len(relPaths) == 0 {
		log.Printf("[ImportMedia][%s] finished with no media saved", postID)
		return
	}

	// Attach to draft post.
	_, err := h.db.ExecContext(ctx, `
		UPDATE public.posts
		   SET media = $3,
		       updated_at = NOW()
		 WHERE id = $1 AND user_id = $2
	`, postID, userID, pq.Array(relPaths))
	if err != nil {
		log.Printf("[ImportMedia][%s] attach_failed err=%v", postID, err)
		return
	}
	log.Printf("[ImportMedia][%s] attached media count=%d", postID, len(relPaths))
}

func extForUpload(filename string, contentType string) string {
	ext := strings.ToLower(strings.TrimSpace(filepath.Ext(filename)))
	if ext != "" && len(ext) <= 16 && strings.HasPrefix(ext, ".") {
		return ext
	}
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if semi := strings.Index(ct, ";"); semi >= 0 {
		ct = strings.TrimSpace(ct[:semi])
	}
	if ct != "" {
		if exts, _ := mime.ExtensionsByType(ct); len(exts) > 0 {
			e := strings.ToLower(strings.TrimSpace(exts[0]))
			if e != "" && strings.HasPrefix(e, ".") && len(e) <= 16 {
				return e
			}
		}
	}
	return ".bin"
}

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
	userHash := mediaUserHash(userID)
	rel := make([]string, 0, len(media))
	files := make([]map[string]interface{}, 0, len(media))
	for _, m := range media {
		orig := strings.TrimSpace(m.Filename)
		if orig == "" {
			orig = "upload.bin"
		}
		orig = reSafeFilename.ReplaceAllString(orig, "_")
		ext := extForUpload(orig, m.ContentType)

		nonce := randHex(16)
		fileHash := hmacSHA256Hex(getMediaHMACSecret(), fmt.Sprintf("file:%s:%s:%s", strings.TrimSpace(userID), nonce, orig))
		prefix := fileHash
		if len(prefix) > 5 {
			prefix = prefix[:5]
		}
		if prefix == "" {
			prefix = "00000"
		}
		fn := fileHash + ext
		dir := filepath.Join("media", userHash, prefix)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, details, err
		}
		path := filepath.Join(dir, fn)
		if err := os.WriteFile(path, m.Bytes, 0o644); err != nil {
			return nil, details, err
		}
		relURL := fmt.Sprintf("/media/%s/%s/%s", userHash, prefix, fn)
		rel = append(rel, relURL)
		files = append(files, map[string]interface{}{
			"filename":    fn,
			"contentType": m.ContentType,
			"size":        len(m.Bytes),
			"url":         relURL,
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
		// `DetectContentType` often falls back to octet-stream for formats like `.mov`.
		// Prefer MIME type derived from file extension when available.
		if strings.HasPrefix(strings.ToLower(ct), "application/octet-stream") {
			if ext := strings.ToLower(filepath.Ext(fn)); ext != "" {
				if byExt := mime.TypeByExtension(ext); byExt != "" {
					ct = byExt
				}
			}
		}
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
		// Allow larger uploads for video-based providers (e.g., TikTok).
		const maxFileSize = 50 << 20 // 50MB each
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
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='facebook_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
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
					INSERT INTO public.social_libraries
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
				INSERT INTO public.social_libraries
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

type tiktokOAuth struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	OpenID      string `json:"openId"`
	Scope       string `json:"scope"`
	ExpiresAt   string `json:"expiresAt"`
}

type youtubeOAuth struct {
	AccessToken  string `json:"accessToken"`
	TokenType    string `json:"tokenType"`
	ExpiresAt    string `json:"expiresAt"`
	RefreshToken string `json:"refreshToken"`
	Scope        string `json:"scope"`
}

type pinterestOAuth struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	ExpiresAt   string `json:"expiresAt"`
	Scope       string `json:"scope"`
}

func (h *Handler) publishInstagramWithImageURLs(ctx context.Context, userID, caption string, imageURLs []string, dryRun bool) (int, error, map[string]interface{}) {
	details := map[string]interface{}{"imageUrls": imageURLs}
	if len(imageURLs) == 0 {
		return 0, fmt.Errorf("instagram_requires_image"), details
	}
	// Load IG token + business account id from UserSettings
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='instagram_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
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
			INSERT INTO public.social_libraries
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

func (h *Handler) deleteInstagramMedia(ctx context.Context, userID string, mediaID string) error {
	// Load IG token from UserSettings.
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='instagram_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("instagram_not_connected")
		}
		return err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("instagram_not_connected")
	}
	var tok instagramOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return fmt.Errorf("instagram_invalid_oauth_payload")
	}
	if strings.TrimSpace(tok.AccessToken) == "" {
		return fmt.Errorf("instagram_not_connected")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s?access_token=%s",
		url.PathEscape(strings.TrimSpace(mediaID)),
		url.QueryEscape(strings.TrimSpace(tok.AccessToken)),
	)

	log.Printf("[ExternalDelete] start userId=%s network=instagram externalId=%s", userID, truncate(mediaID, 64))
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		log.Printf("[ExternalDelete] failed userId=%s network=instagram externalId=%s err=%v", userID, truncate(mediaID, 64), err)
		return err
	}
	defer res.Body.Close()
	trace := strings.TrimSpace(res.Header.Get("x-fb-trace-id"))
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := extractFacebookErrorMessage(b, string(b))
		if strings.TrimSpace(msg) == "" {
			msg = truncate(string(b), 500)
		}
		log.Printf("[ExternalDelete] failed userId=%s network=instagram externalId=%s status=%d trace=%s msg=%s body=%s",
			userID, truncate(mediaID, 64), res.StatusCode, trace, truncate(msg, 300), truncate(string(b), 600))
		if trace != "" {
			return fmt.Errorf("instagram_delete_non_2xx status=%d trace=%s msg=%s", res.StatusCode, trace, truncate(msg, 220))
		}
		return fmt.Errorf("instagram_delete_non_2xx status=%d msg=%s", res.StatusCode, truncate(msg, 220))
	}
	// Typical response: {"success":true}
	log.Printf("[ExternalDelete] ok userId=%s network=instagram externalId=%s", userID, truncate(mediaID, 64))
	return nil
}

func (h *Handler) deleteFacebookObject(ctx context.Context, userID string, objectID string) error {
	// Needs a Page access token. We'll try all page tokens we have for this user.
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='facebook_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("facebook_not_connected")
		}
		return err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("facebook_not_connected")
	}
	var tok fbOAuthPayload
	if err := json.Unmarshal(raw, &tok); err != nil {
		return fmt.Errorf("facebook_invalid_oauth_payload")
	}

	pages := make([]fbOAuthPageRow, 0, len(tok.Pages))
	for _, p := range tok.Pages {
		if strings.TrimSpace(p.ID) != "" && strings.TrimSpace(p.AccessToken) != "" {
			pages = append(pages, p)
		}
	}
	// Backward compat: single page fields.
	if len(pages) == 0 && strings.TrimSpace(tok.PageID) != "" && strings.TrimSpace(tok.AccessToken) != "" {
		name := tok.PageName
		pages = append(pages, fbOAuthPageRow{ID: tok.PageID, Name: &name, AccessToken: tok.AccessToken})
	}
	if len(pages) == 0 {
		return fmt.Errorf("facebook_not_connected")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	var lastErr error
	for _, p := range pages {
		endpoint := fmt.Sprintf("https://graph.facebook.com/v18.0/%s?access_token=%s",
			url.PathEscape(strings.TrimSpace(objectID)),
			url.QueryEscape(strings.TrimSpace(p.AccessToken)),
		)
		req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
		req.Header.Set("Accept", "application/json")
		res, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		_ = res.Body.Close()
		if res.StatusCode >= 200 && res.StatusCode < 300 {
			log.Printf("[ExternalDelete] ok userId=%s network=facebook externalId=%s pageId=%s", userID, truncate(objectID, 64), truncate(p.ID, 64))
			return nil
		}
		trace := strings.TrimSpace(res.Header.Get("x-fb-trace-id"))
		msg := extractFacebookErrorMessage(b, string(b))
		if strings.TrimSpace(msg) == "" {
			msg = truncate(string(b), 500)
		}
		lastErr = fmt.Errorf("facebook_delete_non_2xx status=%d trace=%s msg=%s", res.StatusCode, trace, truncate(msg, 220))
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("facebook_delete_failed")
	}
	return lastErr
}

func (h *Handler) deletePinterestPin(ctx context.Context, userID string, pinID string) error {
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='pinterest_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("pinterest_not_connected")
		}
		return err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("pinterest_not_connected")
	}
	var tok pinterestOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return fmt.Errorf("pinterest_invalid_oauth_payload")
	}
	if strings.TrimSpace(tok.AccessToken) == "" {
		return fmt.Errorf("pinterest_not_connected")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	endpoint := fmt.Sprintf("https://api.pinterest.com/v5/pins/%s", url.PathEscape(strings.TrimSpace(pinID)))
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(tok.AccessToken))
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		log.Printf("[ExternalDelete] ok userId=%s network=pinterest externalId=%s", userID, truncate(pinID, 64))
		return nil
	}
	return fmt.Errorf("pinterest_delete_non_2xx status=%d body=%s", res.StatusCode, truncate(string(b), 300))
}

func (h *Handler) deleteYouTubeVideo(ctx context.Context, userID string, videoID string) error {
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='youtube_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("youtube_not_connected")
		}
		return err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("youtube_not_connected")
	}
	var tok youtubeOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return fmt.Errorf("youtube_invalid_oauth_payload")
	}
	if strings.TrimSpace(tok.AccessToken) == "" {
		return fmt.Errorf("youtube_not_connected")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	endpoint := fmt.Sprintf("https://www.googleapis.com/youtube/v3/videos?id=%s", url.QueryEscape(strings.TrimSpace(videoID)))
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(tok.AccessToken))
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		log.Printf("[ExternalDelete] ok userId=%s network=youtube externalId=%s", userID, truncate(videoID, 64))
		return nil
	}
	return fmt.Errorf("youtube_delete_non_2xx status=%d body=%s", res.StatusCode, truncate(string(b), 300))
}

func (h *Handler) publishTikTokWithVideoURL(ctx context.Context, userID, caption string, videoURL string, dryRun bool) (int, error, map[string]interface{}) {
	details := map[string]interface{}{"videoUrl": videoURL}
	if strings.TrimSpace(videoURL) == "" {
		return 0, fmt.Errorf("tiktok_requires_video"), details
	}

	// Load token from UserSettings
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='tiktok_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, fmt.Errorf("not_connected"), details
		}
		return 0, err, details
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, fmt.Errorf("not_connected"), details
	}
	var tok tiktokOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return 0, fmt.Errorf("invalid_oauth_payload"), map[string]interface{}{"raw": truncate(string(raw), 800)}
	}
	if strings.TrimSpace(tok.AccessToken) == "" || strings.TrimSpace(tok.OpenID) == "" {
		return 0, fmt.Errorf("not_connected"), details
	}

	// Guard: publishing requires video upload/publish scopes (TikTok Content Posting API).
	scopeNorm := strings.ReplaceAll(tok.Scope, " ", ",")
	if !(strings.Contains(scopeNorm, "video.upload") || strings.Contains(scopeNorm, "video.publish")) {
		return 0, fmt.Errorf("missing_scope"), map[string]interface{}{"scope": tok.Scope, "required": []string{"video.upload", "video.publish"}}
	}

	if dryRun {
		return 0, nil, map[string]interface{}{"dryRun": true, "videoUrl": videoURL}
	}

	payload := map[string]interface{}{
		"post_info": map[string]interface{}{
			"title":           truncate(caption, 150),
			"privacy_level":   "PUBLIC_TO_EVERYONE",
			"disable_comment": false,
			"disable_duet":    false,
			"disable_stitch":  false,
		},
		"source_info": map[string]interface{}{
			"source":    "PULL_FROM_URL",
			"video_url": videoURL,
		},
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, "POST", "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", bytes.NewReader(body))
	if err != nil {
		return 0, err, details
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return 0, err, details
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	_ = res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return 0, fmt.Errorf("tiktok_non_2xx"), map[string]interface{}{"status": res.StatusCode, "body": truncate(string(b), 2000)}
	}

	// Response shape varies; keep raw for debugging.
	details["response"] = json.RawMessage(b)
	log.Printf("[TTPost] ok userId=%s", userID)
	// NOTE: inbox flow may require user to finalize in TikTok app. We still mark as "posted 1" for now.
	return 1, nil, details
}

func (h *Handler) publishPinterestWithImageURL(ctx context.Context, userID, caption, imageURL string, dryRun bool) (int, error, map[string]interface{}) {
	details := map[string]interface{}{
		"imageUrl": imageURL,
	}
	if strings.TrimSpace(imageURL) == "" {
		return 0, fmt.Errorf("pinterest_requires_image"), details
	}

	// Load token
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='pinterest_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, fmt.Errorf("not_connected"), details
		}
		return 0, err, details
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, fmt.Errorf("not_connected"), details
	}
	var tok pinterestOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return 0, fmt.Errorf("invalid_oauth_payload"), map[string]interface{}{"raw": truncate(string(raw), 800)}
	}
	if strings.TrimSpace(tok.AccessToken) == "" {
		return 0, fmt.Errorf("not_connected"), details
	}

	// Basic scope guard (Pinterest returns comma-delimited scopes; be permissive).
	scope := strings.ToLower(tok.Scope)
	if scope != "" {
		hasPinsWrite := strings.Contains(scope, "pins:write") || strings.Contains(scope, "pins:write_secret")
		// We fetch boards to select a destination board; older connections that don't include boards scope will fail here.
		hasBoardsRead := strings.Contains(scope, "boards:read") || strings.Contains(scope, "boards:read_secret")
		if !hasPinsWrite || !hasBoardsRead {
			reqScopes := []string{"pins:write", "boards:read"}
			if !hasPinsWrite && hasBoardsRead {
				reqScopes = []string{"pins:write"}
			} else if hasPinsWrite && !hasBoardsRead {
				reqScopes = []string{"boards:read"}
			}
			return 0, fmt.Errorf("missing_scope"), map[string]interface{}{
				"scope":    tok.Scope,
				"required": reqScopes,
			}
		}
	}

	// Best-effort expiration check (Pinterest tokens are often long-lived; we don't refresh here).
	if strings.TrimSpace(tok.ExpiresAt) != "" {
		if t, err := time.Parse(time.RFC3339, tok.ExpiresAt); err == nil {
			if time.Now().After(t.Add(-30 * time.Second)) {
				return 0, fmt.Errorf("token_expired_reconnect"), map[string]interface{}{"expiresAt": tok.ExpiresAt}
			}
		}
	}

	if dryRun {
		return 0, nil, map[string]interface{}{"dryRun": true}
	}

	client := &http.Client{Timeout: 60 * time.Second}
	authHeader := "Bearer " + tok.AccessToken

	type pinAPIError struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	isTrialSandboxError := func(status int, body []byte) bool {
		if status != http.StatusForbidden {
			return false
		}
		var pe pinAPIError
		if err := json.Unmarshal(body, &pe); err == nil {
			if pe.Code == 29 {
				return true
			}
			if strings.Contains(strings.ToLower(pe.Message), "trial access") && strings.Contains(strings.ToLower(pe.Message), "api-sandbox") {
				return true
			}
		}
		// fallback: substring match
		lb := strings.ToLower(string(body))
		return strings.Contains(lb, "trial access") && strings.Contains(lb, "api-sandbox.pinterest.com")
	}

	publishOnce := func(apiBase string) (int, error, map[string]interface{}, bool) {
		local := map[string]interface{}{"apiBase": apiBase}

		// 1) Find a board (or create a default one)
		boardID := ""
		{
			reqURL := strings.TrimRight(apiBase, "/") + "/v5/boards?page_size=25"
			req, _ := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
			req.Header.Set("Authorization", authHeader)
			req.Header.Set("Accept", "application/json")
			res, err := client.Do(req)
			if err != nil {
				return 0, err, local, false
			}
			body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			_ = res.Body.Close()
			if res.StatusCode < 200 || res.StatusCode >= 300 {
				// Some trial apps may require sandbox even for write; keep boards failure verbose.
				return 0, fmt.Errorf("pinterest_boards_non_2xx"), map[string]interface{}{"apiBase": apiBase, "status": res.StatusCode, "body": truncate(string(body), 2000)}, isTrialSandboxError(res.StatusCode, body)
			}
			var parsed map[string]interface{}
			_ = json.Unmarshal(body, &parsed)
			items, _ := parsed["items"].([]interface{})
			if len(items) > 0 {
				if m, _ := items[0].(map[string]interface{}); m != nil {
					if id, _ := m["id"].(string); id != "" {
						boardID = id
					}
				}
			}
			local["boardsList"] = map[string]interface{}{"count": len(items)}
		}

		if boardID == "" {
			create := map[string]interface{}{
				"name":        "Simple Social Thing",
				"description": "Created by Simple Social Thing",
				"privacy":     "PUBLIC",
			}
			b, _ := json.Marshal(create)
			req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(apiBase, "/")+"/v5/boards", bytes.NewReader(b))
			req.Header.Set("Authorization", authHeader)
			req.Header.Set("Accept", "application/json")
			req.Header.Set("Content-Type", "application/json")
			res, err := client.Do(req)
			if err != nil {
				return 0, err, local, false
			}
			body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			_ = res.Body.Close()
			if res.StatusCode < 200 || res.StatusCode >= 300 {
				return 0, fmt.Errorf("pinterest_create_board_non_2xx"), map[string]interface{}{"apiBase": apiBase, "status": res.StatusCode, "body": truncate(string(body), 2000)}, isTrialSandboxError(res.StatusCode, body)
			}
			var parsed map[string]interface{}
			_ = json.Unmarshal(body, &parsed)
			if id, _ := parsed["id"].(string); id != "" {
				boardID = id
			}
			local["createdBoard"] = json.RawMessage(body)
		}
		if boardID == "" {
			return 0, fmt.Errorf("pinterest_no_board"), local, false
		}
		local["boardId"] = boardID

		// 2) Create pin
		title := strings.TrimSpace(caption)
		if title == "" {
			title = "New pin"
		}
		if len(title) > 95 {
			title = truncate(title, 95)
		}
		pinReq := map[string]interface{}{
			"board_id":     boardID,
			"title":        title,
			"description":  caption,
			"media_source": map[string]interface{}{"source_type": "image_url", "url": imageURL},
		}
		pinBytes, _ := json.Marshal(pinReq)
		req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(apiBase, "/")+"/v5/pins", bytes.NewReader(pinBytes))
		req.Header.Set("Authorization", authHeader)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			return 0, err, local, false
		}
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
		_ = res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return 0, fmt.Errorf("pinterest_create_pin_non_2xx"), map[string]interface{}{"apiBase": apiBase, "status": res.StatusCode, "body": truncate(string(body), 3000)}, isTrialSandboxError(res.StatusCode, body)
		}

		var pinParsed map[string]interface{}
		_ = json.Unmarshal(body, &pinParsed)
		pinID, _ := pinParsed["id"].(string)
		link, _ := pinParsed["link"].(string)
		if link == "" && pinID != "" {
			// If we're using the sandbox API, prefer sandbox web URLs for click-throughs.
			if strings.Contains(strings.ToLower(apiBase), "api-sandbox.pinterest.com") {
				link = fmt.Sprintf("https://www-sandbox.pinterest.com/pin/%s/", pinID)
			} else {
				link = fmt.Sprintf("https://www.pinterest.com/pin/%s/", pinID)
			}
		}
		local["pinId"] = pinID
		local["response"] = json.RawMessage(body)

		if pinID != "" {
			rawPayload := strings.ReplaceAll(string(body), "\x00", "")
			if !utf8.ValidString(rawPayload) {
				rawPayload = strings.ToValidUTF8(rawPayload, "�")
			}
			rowID := fmt.Sprintf("pinterest:%s:%s", userID, pinID)
			_, _ = h.db.ExecContext(ctx, `
				INSERT INTO public.social_libraries
				  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
				VALUES
				  ($1, $2, 'pinterest', 'pin', NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULL, NOW(), NULL, NULL, $6::jsonb, $7, NOW(), NOW())
				ON CONFLICT (user_id, network, external_id)
				DO UPDATE SET
				  title = EXCLUDED.title,
				  permalink_url = EXCLUDED.permalink_url,
				  media_url = EXCLUDED.media_url,
				  raw_payload = EXCLUDED.raw_payload,
				  updated_at = NOW()
			`, rowID, userID, title, link, imageURL, rawPayload, pinID)
		}

		log.Printf("[PINPublish] ok userId=%s pinId=%s apiBase=%s", userID, pinID, apiBase)
		return 1, nil, local, false
	}

	// Allow overriding the Pinterest API base (useful for trial apps that must use api-sandbox).
	apiBase := strings.TrimSpace(os.Getenv("PINTEREST_API_BASE"))
	if apiBase == "" {
		apiBase = "https://api.pinterest.com"
	}
	if strings.EqualFold(apiBase, "sandbox") {
		apiBase = "https://api-sandbox.pinterest.com"
	}
	details["apiBaseConfigured"] = apiBase

	// Trial apps cannot create pins using the production API host; Pinterest returns code=29 and instructs using api-sandbox.
	posted, err, det, trial := publishOnce(apiBase)
	if err == nil {
		for k, v := range det {
			details[k] = v
		}
		return posted, nil, details
	}
	// If we were already using sandbox and still got a "trial/sandbox" error, return the underlying error details.
	if trial && strings.Contains(strings.ToLower(apiBase), "api-sandbox.pinterest.com") {
		for k, v := range det {
			details[k] = v
		}
		return 0, fmt.Errorf("pinterest_sandbox_non_2xx"), details
	}

	if trial {
		posted2, err2, det2, _ := publishOnce("https://api-sandbox.pinterest.com")
		if err2 == nil {
			details["sandboxFallback"] = true
			for k, v := range det2 {
				details[k] = v
			}
			return posted2, nil, details
		}
		details["sandboxFallback"] = true
		details["sandboxError"] = det2
		// Return the underlying sandbox error so it's actionable (boards vs create-pin vs auth/scope).
		log.Printf("[PINPublish] sandbox_failed userId=%s err=%v det=%v", userID, err2, det2)
		return 0, fmt.Errorf("pinterest_sandbox_failed:%s", err2.Error()), details
	}

	for k, v := range det {
		details[k] = v
	}
	return 0, err, details
}

func (h *Handler) publishYouTubeWithVideoBytes(ctx context.Context, userID, caption string, video uploadedMedia, dryRun bool) (int, error, map[string]interface{}) {
	details := map[string]interface{}{
		"contentType": video.ContentType,
		"size":        len(video.Bytes),
	}
	if len(video.Bytes) == 0 {
		return 0, fmt.Errorf("youtube_requires_video"), details
	}

	// Load token
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='youtube_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return 0, fmt.Errorf("not_connected"), details
		}
		return 0, err, details
	}
	if len(raw) == 0 || string(raw) == "null" {
		return 0, fmt.Errorf("not_connected"), details
	}
	var tok youtubeOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return 0, fmt.Errorf("invalid_oauth_payload"), map[string]interface{}{"raw": truncate(string(raw), 800)}
	}
	if strings.TrimSpace(tok.AccessToken) == "" {
		return 0, fmt.Errorf("not_connected"), details
	}

	// Guard: publishing requires youtube.upload
	if !strings.Contains(tok.Scope, "youtube.upload") {
		return 0, fmt.Errorf("missing_scope"), map[string]interface{}{"scope": tok.Scope, "required": []string{"https://www.googleapis.com/auth/youtube.upload"}}
	}

	// Best-effort: detect expiration (we don't refresh tokens server-side yet).
	if strings.TrimSpace(tok.ExpiresAt) != "" {
		if t, err := time.Parse(time.RFC3339, tok.ExpiresAt); err == nil {
			if time.Now().After(t.Add(-30 * time.Second)) {
				return 0, fmt.Errorf("token_expired_reconnect"), map[string]interface{}{"expiresAt": tok.ExpiresAt}
			}
		}
	}

	if dryRun {
		return 0, nil, map[string]interface{}{"dryRun": true}
	}

	title := strings.TrimSpace(caption)
	if title == "" {
		title = "New video"
	}
	if len(title) > 95 {
		title = truncate(title, 95)
	}

	meta := map[string]interface{}{
		"snippet": map[string]interface{}{
			"title":       title,
			"description": caption,
			"categoryId":  "22",
		},
		"status": map[string]interface{}{
			"privacyStatus": "public",
		},
	}
	metaBytes, _ := json.Marshal(meta)

	client := &http.Client{Timeout: 120 * time.Second}
	initURL := "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
	initReq, err := http.NewRequestWithContext(ctx, "POST", initURL, bytes.NewReader(metaBytes))
	if err != nil {
		return 0, err, details
	}
	initReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	initReq.Header.Set("Content-Type", "application/json; charset=UTF-8")
	initReq.Header.Set("Accept", "application/json")
	initReq.Header.Set("X-Upload-Content-Length", fmt.Sprintf("%d", len(video.Bytes)))
	if video.ContentType != "" {
		initReq.Header.Set("X-Upload-Content-Type", video.ContentType)
	}

	initRes, err := client.Do(initReq)
	if err != nil {
		return 0, err, details
	}
	initBody, _ := io.ReadAll(io.LimitReader(initRes.Body, 1<<20))
	_ = initRes.Body.Close()
	if initRes.StatusCode < 200 || initRes.StatusCode >= 300 {
		return 0, fmt.Errorf("youtube_init_non_2xx"), map[string]interface{}{"status": initRes.StatusCode, "body": truncate(string(initBody), 2000)}
	}
	uploadURL := initRes.Header.Get("Location")
	if uploadURL == "" {
		return 0, fmt.Errorf("youtube_missing_upload_url"), map[string]interface{}{"headers": initRes.Header}
	}

	putReq, err := http.NewRequestWithContext(ctx, "PUT", uploadURL, bytes.NewReader(video.Bytes))
	if err != nil {
		return 0, err, details
	}
	putReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	if video.ContentType != "" {
		putReq.Header.Set("Content-Type", video.ContentType)
	} else {
		putReq.Header.Set("Content-Type", "application/octet-stream")
	}
	putReq.Header.Set("Content-Length", fmt.Sprintf("%d", len(video.Bytes)))

	putRes, err := client.Do(putReq)
	if err != nil {
		return 0, err, details
	}
	putBody, _ := io.ReadAll(io.LimitReader(putRes.Body, 4<<20))
	_ = putRes.Body.Close()
	if putRes.StatusCode < 200 || putRes.StatusCode >= 300 {
		return 0, fmt.Errorf("youtube_upload_non_2xx"), map[string]interface{}{"status": putRes.StatusCode, "body": truncate(string(putBody), 3000)}
	}

	var published map[string]interface{}
	_ = json.Unmarshal(putBody, &published)
	videoID, _ := published["id"].(string)
	details["videoId"] = videoID
	details["response"] = json.RawMessage(putBody)

	if videoID != "" {
		permalink := fmt.Sprintf("https://www.youtube.com/watch?v=%s", videoID)
		rawPayload := strings.ReplaceAll(string(putBody), "\x00", "")
		if !utf8.ValidString(rawPayload) {
			rawPayload = strings.ToValidUTF8(rawPayload, "�")
		}
		rowID := fmt.Sprintf("youtube:%s:%s", userID, videoID)
		_, _ = h.db.ExecContext(ctx, `
			INSERT INTO public.social_libraries
			  (id, user_id, network, content_type, title, permalink_url, media_url, thumbnail_url, posted_at, views, likes, raw_payload, external_id, created_at, updated_at)
			VALUES
			  ($1, $2, 'youtube', 'video', NULLIF($3,''), $4, $4, NULL, NOW(), NULL, NULL, $5::jsonb, $6, NOW(), NOW())
			ON CONFLICT (user_id, network, external_id)
			DO UPDATE SET
			  title = EXCLUDED.title,
			  permalink_url = EXCLUDED.permalink_url,
			  media_url = EXCLUDED.media_url,
			  raw_payload = EXCLUDED.raw_payload,
			  updated_at = NOW()
		`, rowID, userID, title, permalink, rawPayload, videoID)
	}

	log.Printf("[YTPublish] ok userId=%s videoId=%s", userID, videoID)
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
	// Accept both 'url' and 'audioUrl' fields
	if req.AudioURL == "" && req.URL != "" {
		req.AudioURL = req.URL
	}
	if req.AudioURL == "" {
		log.Printf("[Suno][Store] missing audioUrl/url in request: %+v", req)
		http.Error(w, "audioUrl is required", http.StatusBadRequest)
		return
	}
	// Accept both 'trackId' and 'sunoTrackId' fields
	if req.SunoTrackID == "" && req.TrackID != "" {
		req.SunoTrackID = req.TrackID
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
		INSERT INTO public.suno_tracks (id, user_id, prompt, suno_track_id, audio_url, file_path, status, updated_at)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5, $6, 'completed', NOW())
	`
	if _, err := h.db.Exec(query, id, req.UserID, req.Prompt, req.SunoTrackID, req.AudioURL, filePath); err != nil {
		log.Printf("[Suno][Store] DB insert error: %v", err)
		http.Error(w, fmt.Sprintf("failed to insert metadata: %v", err), http.StatusInternalServerError)
		return
	}
	log.Printf("[Suno][Store] stored id=%s file=%s userId=%s", id, filePath, req.UserID)

	writeJSON(w, http.StatusOK, sunoStoreResponse{
		OK:       true,
		ID:       id,
		FilePath: filePath,
	})
}

// SunoMusicCallback receives async generation callbacks from the SunoAPI provider.
// We currently accept and log the payload for observability and return 200 quickly.
// Docs: https://docs.sunoapi.org/suno-api/generate-music (Music Generation Callbacks)
func (h *Handler) SunoMusicCallback(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
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
	if err := h.db.QueryRow(`SELECT id FROM public.suno_tracks WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`, taskID).Scan(&trackID); err != nil {
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
		UPDATE public.suno_tracks
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

	// Generate taskId if not provided
	if req.TaskID == "" {
		req.TaskID = fmt.Sprintf("task-%d", time.Now().UnixNano())
	}

	id := fmt.Sprintf("suno-%d", time.Now().UnixNano())
	query := `
		INSERT INTO public.suno_tracks (id, user_id, prompt, task_id, model, status, created_at, updated_at)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, 'pending', NOW(), NOW())
	`
	if _, err := h.db.Exec(query, id, req.UserID, req.Prompt, req.TaskID, req.Model); err != nil {
		log.Printf("[Suno][CreateTask] DB insert error: %v", err)
		http.Error(w, fmt.Sprintf("failed to insert task: %v", err), http.StatusInternalServerError)
		return
	}
	log.Printf("[Suno][CreateTask] created id=%s taskId=%s userId=%s", id, req.TaskID, req.UserID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":     true,
		"id":     id,
		"taskId": req.TaskID,
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
		UPDATE public.suno_tracks
		SET title = COALESCE(NULLIF($1, ''), title),
		    suno_track_id = COALESCE(NULLIF($2, ''), suno_track_id),
		    audio_url = COALESCE(NULLIF($3, ''), audio_url),
		    file_path = COALESCE(NULLIF($4, ''), file_path),
		    status = COALESCE(NULLIF($5, ''), status),
		    updated_at = NOW()
		WHERE id = $6
		RETURNING id, user_id, title, prompt, suno_track_id, audio_url, file_path, status, created_at, updated_at
	`
	var track struct {
		ID          string     `json:"id"`
		UserID      *string    `json:"userId,omitempty"`
		Title       *string    `json:"title,omitempty"`
		Prompt      *string    `json:"prompt,omitempty"`
		SunoTrackID *string    `json:"sunoTrackId,omitempty"`
		AudioURL    *string    `json:"audioUrl,omitempty"`
		FilePath    *string    `json:"filePath,omitempty"`
		Status      *string    `json:"status,omitempty"`
		CreatedAt   time.Time  `json:"createdAt"`
		UpdatedAt   *time.Time `json:"updatedAt,omitempty"`
	}
	var userID, title, prompt, sunoTrackID, audioURL, filePathDB, status sql.NullString
	var updatedAt sql.NullTime
	if err := h.db.QueryRow(query, req.Title, req.SunoTrackID, req.AudioURL, filePath, req.Status, trackID).Scan(
		&track.ID, &userID, &title, &prompt, &sunoTrackID, &audioURL, &filePathDB, &status, &track.CreatedAt, &updatedAt,
	); err != nil {
		log.Printf("[Suno][UpdateTrack] DB update error: %v", err)
		http.Error(w, fmt.Sprintf("failed to update track: %v", err), http.StatusInternalServerError)
		return
	}
	if userID.Valid {
		s := userID.String
		track.UserID = &s
	}
	if title.Valid {
		s := title.String
		track.Title = &s
	}
	if prompt.Valid {
		s := prompt.String
		track.Prompt = &s
	}
	if sunoTrackID.Valid {
		s := sunoTrackID.String
		track.SunoTrackID = &s
	}
	if audioURL.Valid {
		s := audioURL.String
		track.AudioURL = &s
	}
	if filePathDB.Valid {
		s := filePathDB.String
		track.FilePath = &s
	}
	if status.Valid {
		s := status.String
		track.Status = &s
	}
	if updatedAt.Valid {
		track.UpdatedAt = &updatedAt.Time
	}
	log.Printf("[Suno][UpdateTrack] updated id=%s status=%v", trackID, track.Status)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "title": track.Title})
}

func (h *Handler) GetUserSetting(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	settingKey := vars["key"]
	log.Printf("[UserSettings][Get] userId=%s key=%s", userID, settingKey)

	query := `SELECT value FROM public.user_settings WHERE user_id = $1 AND key = $2`
	var raw []byte
	err := h.db.QueryRow(query, userID, settingKey).Scan(&raw)
	if err == sql.ErrNoRows {
		log.Printf("[UserSettings][Get] not found userId=%s key=%s", userID, settingKey)
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
		return
	}
	if err != nil {
		log.Printf("[UserSettings][Get] query error userId=%s key=%s err=%v", userID, settingKey, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"key": settingKey, "value": json.RawMessage(raw)})
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
		INSERT INTO public.user_settings (user_id, key, value, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`
	if _, err := h.db.Exec(query, userID, settingKey, valueBytes); err != nil {
		log.Printf("[UserSettings][Upsert] DB upsert error userId=%s key=%s err=%v", userID, settingKey, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("[UserSettings][Upsert] success userId=%s key=%s", userID, settingKey)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "key": settingKey, "value": json.RawMessage(valueBytes)})
}

func (h *Handler) GetUserSettings(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	if userID == "" {
		http.Error(w, "userId is required", http.StatusBadRequest)
		return
	}

	query := `SELECT key, value FROM public.user_settings WHERE user_id = $1`
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

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": out})
}
