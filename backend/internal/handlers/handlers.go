package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/PortNumber53/simple-social-thing/backend/internal/models"
	"github.com/gorilla/mux"
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
			email = EXCLUDED.email,
			name = EXCLUDED.name,
			"imageUrl" = EXCLUDED."imageUrl"
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

type sunoStoreResponse struct {
	OK       bool   `json:"ok"`
	ID       string `json:"id"`
	FilePath string `json:"filePath"`
}

func (h *Handler) StoreSunoTrack(w http.ResponseWriter, r *http.Request) {
	var req sunoStoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.AudioURL == "" {
		http.Error(w, "audioUrl is required", http.StatusBadRequest)
		return
	}

	// Download audio
	resp, err := http.Get(req.AudioURL)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to download audio: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("downstream responded with %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	// Ensure media directory exists
	mediaDir := "media/suno"
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("failed to create media dir: %v", err), http.StatusInternalServerError)
		return
	}

	// Generate ID and file path
	id := fmt.Sprintf("suno-%d", time.Now().UnixNano())
	fileName := fmt.Sprintf("%s.mp3", id)
	filePath := filepath.Join(mediaDir, fileName)

	out, err := os.Create(filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create file: %v", err), http.StatusInternalServerError)
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		http.Error(w, fmt.Sprintf("failed to save file: %v", err), http.StatusInternalServerError)
		return
	}

	// Persist metadata to DB
	query := `
		INSERT INTO public."SunoTracks" (id, user_id, prompt, suno_track_id, audio_url, file_path)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5, $6)
	`
	if _, err := h.db.Exec(query, id, req.UserID, req.Prompt, req.SunoTrackID, req.AudioURL, filePath); err != nil {
		http.Error(w, fmt.Sprintf("failed to insert metadata: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sunoStoreResponse{
		OK:       true,
		ID:       id,
		FilePath: filePath,
	})
}

func (h *Handler) GetUserSetting(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["userId"]
	settingKey := vars["key"]

	query := `SELECT value FROM public."UserSettings" WHERE user_id = $1 AND key = $2`
	var raw []byte
	err := h.db.QueryRow(query, userID, settingKey).Scan(&raw)
	if err == sql.ErrNoRows {
		w.WriteHeader(http.StatusNotFound)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"error":"not_found"}`))
		return
	}
	if err != nil {
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

	var body struct {
		Value interface{} `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	valueBytes, err := json.Marshal(body.Value)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO public."UserSettings" (user_id, key, value, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`
	if _, err := h.db.Exec(query, userID, settingKey, valueBytes); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}
