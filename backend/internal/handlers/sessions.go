package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/http"
	"time"
)

const sessionDuration = 30 * 24 * time.Hour // 30 days

// generateSessionToken returns a cryptographically random 64-char hex string.
func generateSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// CreateSession creates a new session row for the given user ID and returns the token.
// POST /api/sessions  body: {"userId":"..."}
func (h *Handler) CreateSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"userId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.UserID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	token, err := generateSessionToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate session token")
		return
	}

	expiresAt := time.Now().Add(sessionDuration)
	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO public.sessions (token, user_id, created_at, expires_at, updated_at)
		VALUES ($1, $2, NOW(), $3, NOW())
	`, token, body.UserID, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"token":     token,
		"userId":    body.UserID,
		"expiresAt": expiresAt,
	})
}

// ResolveSession looks up a session by token and returns the associated user ID.
// Returns 404 if the session does not exist or has expired.
// GET /api/sessions/{token}
func (h *Handler) ResolveSession(w http.ResponseWriter, r *http.Request) {
	token := pathVar(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	var userID string
	var expiresAt time.Time
	err := h.db.QueryRowContext(r.Context(), `
		SELECT user_id, expires_at FROM public.sessions WHERE token = $1
	`, token).Scan(&userID, &expiresAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if time.Now().After(expiresAt) {
		// Clean up expired session
		_, _ = h.db.ExecContext(r.Context(), `DELETE FROM public.sessions WHERE token = $1`, token)
		writeError(w, http.StatusNotFound, "session expired")
		return
	}

	// Update last-access time
	_, _ = h.db.ExecContext(r.Context(), `
		UPDATE public.sessions SET updated_at = NOW() WHERE token = $1
	`, token)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"userId":    userID,
		"expiresAt": expiresAt,
	})
}

// DeleteSession deletes a session by token (logout).
// DELETE /api/sessions/{token}
func (h *Handler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	token := pathVar(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}

	_, err := h.db.ExecContext(r.Context(), `DELETE FROM public.sessions WHERE token = $1`, token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// CreateSessionForUser is an internal helper that creates a session row and returns
// the token. It is used by the Google OAuth callback to avoid a round-trip through HTTP.
func (h *Handler) CreateSessionForUser(r *http.Request, userID string) (string, error) {
	token, err := generateSessionToken()
	if err != nil {
		return "", err
	}
	expiresAt := time.Now().Add(sessionDuration)
	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO public.sessions (token, user_id, created_at, expires_at, updated_at)
		VALUES ($1, $2, NOW(), $3, NOW())
	`, token, userID, expiresAt)
	if err != nil {
		return "", err
	}
	return token, nil
}
