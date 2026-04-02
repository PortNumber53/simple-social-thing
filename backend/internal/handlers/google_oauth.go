package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GoogleOAuthConfig holds the configuration for Google OAuth.
type GoogleOAuthConfig struct {
	ClientID    string
	Secret      string
	CallbackURL string // relative path, e.g. "/auth/google/callback"
	BackendURL  string // full backend origin, e.g. "https://api-simple14.dev.portnumber53.com"
	FrontendURL string // full frontend origin, e.g. "https://simple14.dev.portnumber53.com"
}

// GoogleOAuthCallback handles the Google OAuth authorization code callback.
// It exchanges the code for tokens, fetches user info, upserts the user and
// social connection, sets a session cookie, and redirects to the frontend.
func (h *Handler) GoogleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	oauthErr := r.URL.Query().Get("error")

	cfg := h.googleOAuth
	if cfg == nil {
		http.Error(w, "Google OAuth not configured", http.StatusInternalServerError)
		return
	}

	frontendURL := strings.TrimRight(cfg.FrontendURL, "/")

	if oauthErr != "" {
		desc := r.URL.Query().Get("error_description")
		redirectWithError(w, r, frontendURL, oauthErr, desc)
		return
	}

	if code == "" {
		redirectWithError(w, r, frontendURL, "missing_code", "Authorization code is required")
		return
	}

	// Build the redirect_uri that must match what was sent to Google.
	redirectURI := strings.TrimRight(cfg.BackendURL, "/") + cfg.CallbackURL

	// Exchange authorization code for access token.
	tokenData, err := exchangeGoogleCode(code, cfg.ClientID, cfg.Secret, redirectURI)
	if err != nil {
		log.Printf("[GoogleOAuth] token exchange failed: %v", err)
		redirectWithError(w, r, frontendURL, "token_exchange_failed", "Failed to exchange authorization code")
		return
	}

	// Fetch user info from Google.
	userInfo, err := fetchGoogleUserInfo(tokenData.AccessToken)
	if err != nil {
		log.Printf("[GoogleOAuth] user info fetch failed: %v", err)
		redirectWithError(w, r, frontendURL, "user_info_failed", "Failed to fetch user information")
		return
	}

	// Upsert user into database.
	var userID string
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO public.users (id, email, name, image_url, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (id) DO UPDATE SET
			email = COALESCE(NULLIF(EXCLUDED.email, ''), public.users.email),
			name = COALESCE(NULLIF(EXCLUDED.name, ''), public.users.name),
			image_url = COALESCE(EXCLUDED.image_url, public.users.image_url)
		RETURNING id
	`, userInfo.ID, userInfo.Email, userInfo.Name, userInfo.Picture).Scan(&userID)
	if err != nil {
		log.Printf("[GoogleOAuth] user upsert failed: %v", err)
		redirectWithError(w, r, frontendURL, "internal_error", "Failed to persist user")
		return
	}
	log.Printf("[GoogleOAuth] user upserted: %s", userID)

	// Upsert social connection.
	connID := fmt.Sprintf("google:%s", userInfo.ID)
	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO public.social_connections (id, user_id, provider, provider_id, email, name, created_at)
		VALUES ($1, $2, 'google', $3, $4, $5, NOW())
		ON CONFLICT (user_id, provider) DO UPDATE SET
			provider_id = EXCLUDED.provider_id,
			email = EXCLUDED.email,
			name = EXCLUDED.name
	`, connID, userID, userInfo.ID, userInfo.Email, userInfo.Name)
	if err != nil {
		log.Printf("[GoogleOAuth] social connection upsert failed: %v", err)
		// Non-fatal — continue with redirect.
	}

	// Build frontend redirect with user data + set session cookie.
	userData := map[string]interface{}{
		"success": true,
		"user": map[string]interface{}{
			"id":          userID,
			"email":       userInfo.Email,
			"name":        userInfo.Name,
			"imageUrl":    userInfo.Picture,
			"accessToken": tokenData.AccessToken,
		},
	}
	encoded, _ := json.Marshal(userData)

	isSecure := strings.HasPrefix(cfg.FrontendURL, "https")
	cookie := &http.Cookie{
		Name:     "sid",
		Value:    userID,
		Path:     "/",
		MaxAge:   60 * 60 * 24 * 30, // 30 days
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isSecure,
	}
	// Set Domain to allow cookie sharing between backend and frontend on the same parent domain.
	frontendHost := extractHost(cfg.FrontendURL)
	backendHost := extractHost(cfg.BackendURL)
	if sharedDomain := commonParentDomain(frontendHost, backendHost); sharedDomain != "" {
		cookie.Domain = sharedDomain
	}
	http.SetCookie(w, cookie)

	redirectURL := fmt.Sprintf("%s?oauth=%s", frontendURL, url.QueryEscape(string(encoded)))
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func redirectWithError(w http.ResponseWriter, r *http.Request, frontendURL, errCode, errDesc string) {
	data := map[string]interface{}{
		"success": false,
		"error":   errCode,
	}
	if errDesc != "" {
		data["error_description"] = errDesc
	}
	encoded, _ := json.Marshal(data)
	redirectURL := fmt.Sprintf("%s?oauth=%s", frontendURL, url.QueryEscape(string(encoded)))
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// --- Google API types and helpers ---

type googleTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope"`
}

type googleUserInfo struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

func exchangeGoogleCode(code, clientID, clientSecret, redirectURI string) (*googleTokenResponse, error) {
	resp, err := http.PostForm("https://oauth2.googleapis.com/token", url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirectURI},
	})
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var body map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return nil, fmt.Errorf("token exchange returned %d: %v", resp.StatusCode, body)
	}

	var token googleTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}
	return &token, nil
}

func fetchGoogleUserInfo(accessToken string) (*googleUserInfo, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("user info request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("user info returned %d", resp.StatusCode)
	}

	var info googleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode user info: %w", err)
	}
	return &info, nil
}

// extractHost returns just the hostname (no port) from a URL string.
func extractHost(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// commonParentDomain returns the shared parent domain (with leading dot) if
// two hosts share at least a two-label suffix (e.g. "dev.portnumber53.com").
// Returns "" when the hosts are localhost, IPs, or don't share a parent.
func commonParentDomain(a, b string) string {
	if a == "" || b == "" {
		return ""
	}
	if a == "localhost" || b == "localhost" {
		return ""
	}
	partsA := strings.Split(a, ".")
	partsB := strings.Split(b, ".")
	if len(partsA) < 2 || len(partsB) < 2 {
		return ""
	}
	// Walk from the right to find the longest shared suffix.
	i, j := len(partsA)-1, len(partsB)-1
	var shared []string
	for i >= 0 && j >= 0 && partsA[i] == partsB[j] {
		shared = append([]string{partsA[i]}, shared...)
		i--
		j--
	}
	if len(shared) < 2 {
		return ""
	}
	return "." + strings.Join(shared, ".")
}
