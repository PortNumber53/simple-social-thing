package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
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
	if err := os.MkdirAll(mediaDir, 0755); err != nil {
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
	_ = h // placeholder for future DB updates (task status -> SunoTracks)
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB cap
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	log.Printf("[Suno][Callback] %s", string(body))
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
		if err := os.MkdirAll(mediaDir, 0755); err != nil {
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
