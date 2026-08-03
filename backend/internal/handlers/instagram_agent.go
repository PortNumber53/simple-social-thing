package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const instagramAgentSystemPrompt = "You are an expert Instagram content creator and social media strategist. Help users create engaging posts, captions, hashtags, and content strategies. Consider visual storytelling, strong first-line hooks, relevant calls to action, readable formatting, and a balanced mix of broad and niche hashtags."

var instagramAgentHTTPClient = &http.Client{Timeout: 120 * time.Second}

type instagramContentRequest struct {
	Type             string `json:"type"`
	Input            string `json:"input"`
	Style            string `json:"style"`
	Tone             string `json:"tone"`
	Goals            string `json:"goals"`
	Count            int    `json:"count"`
	IncludeHashtags  *bool  `json:"includeHashtags"`
	IncludeRationale bool   `json:"includeRationale"`
	Stream           bool   `json:"stream"`
}

type instagramImageRequest struct {
	Prompt   string  `json:"prompt"`
	Seed     *int64  `json:"seed,omitempty"`
	Steps    int     `json:"steps,omitempty"`
	Height   int     `json:"height,omitempty"`
	Width    int     `json:"width,omitempty"`
	Guidance float64 `json:"guidance,omitempty"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// GenerateInstagramContent ports Instagram-Agent's chat, post, caption,
// hashtag, and strategy tools onto the existing authenticated web app.
func (h *Handler) GenerateInstagramContent(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	var input instagramContentRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	prompt, err := buildInstagramContentPrompt(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("LLM_API_KEY"))
	if apiKey == "" {
		writeError(w, http.StatusServiceUnavailable, "llm_not_configured")
		return
	}
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("LLM_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "http://localhost:3001/v1"
	}
	model := strings.TrimSpace(os.Getenv("LLM_MODEL"))
	if model == "" {
		model = "auto"
	}

	messages := []map[string]string{{"role": "system", "content": instagramAgentSystemPrompt}}
	if input.IncludeRationale {
		messages = append(messages, map[string]string{
			"role":    "system",
			"content": "After the requested result, add a short 'Why this works' section that summarizes the key content choices. Do not reveal private chain-of-thought or hidden reasoning.",
		})
	}
	messages = append(messages, map[string]string{"role": "user", "content": prompt})
	payload := map[string]interface{}{
		"model":       model,
		"messages":    messages,
		"stream":      input.Stream,
		"temperature": 0.7,
		"max_tokens":  2048,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "llm_request_failed")
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")

	res, err := instagramAgentHTTPClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "llm_unreachable")
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":   "llm_request_failed",
			"status":  res.StatusCode,
			"details": truncate(string(b), 1200),
		})
		return
	}

	if input.Stream {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		buf := make([]byte, 16<<10)
		for {
			n, readErr := res.Body.Read(buf)
			if n > 0 {
				if _, writeErr := w.Write(buf[:n]); writeErr != nil {
					return
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
			if readErr != nil {
				return
			}
		}
	}

	var result openAIChatResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&result); err != nil {
		writeError(w, http.StatusBadGateway, "llm_invalid_response")
		return
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		writeError(w, http.StatusBadGateway, "llm_empty_response")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"type":    normalizeInstagramContentType(input.Type),
		"content": strings.TrimSpace(result.Choices[0].Message.Content),
		"model":   model,
	})
}

func buildInstagramContentPrompt(input instagramContentRequest) (string, error) {
	kind := normalizeInstagramContentType(input.Type)
	text := strings.TrimSpace(input.Input)
	if text == "" {
		return "", fmt.Errorf("input is required")
	}
	if len(text) > 12000 {
		return "", fmt.Errorf("input is too long")
	}

	switch kind {
	case "chat":
		return text, nil
	case "post":
		style := defaultString(input.Style, "professional")
		includeHashtags := input.IncludeHashtags == nil || *input.IncludeHashtags
		hashtagInstruction := "Do not include hashtags."
		if includeHashtags {
			hashtagInstruction = "Include 10-15 relevant hashtags."
		}
		return fmt.Sprintf("Create an Instagram post about: %s\nStyle: %s\n%s\nFormat the caption with line breaks for readability. Return only the caption text.", text, style, hashtagInstruction), nil
	case "caption":
		return fmt.Sprintf("Write an Instagram caption for an image described as:\n%s\n\nTone: %s\nKeep it concise but compelling and include a call to action. Return only the caption text.", text, defaultString(input.Tone, "engaging")), nil
	case "hashtags":
		count := input.Count
		if count == 0 {
			count = 15
		}
		if count < 1 || count > 30 {
			return "", fmt.Errorf("count must be between 1 and 30")
		}
		return fmt.Sprintf("Generate %d strategic hashtags for Instagram content about:\n%s\n\nMix broad/popular and niche hashtags. Return a single line containing only hashtags.", count, text), nil
	case "strategy":
		return fmt.Sprintf("Create an Instagram content strategy for the %q niche.\nPrimary goal: %s\n\nInclude 4-5 content pillars, posting frequency, best posting times, recommended formats (Reels, Stories, and Carousels), and niche-specific growth tactics.", text, defaultString(input.Goals, "growth")), nil
	default:
		return "", fmt.Errorf("type must be chat, post, caption, hashtags, or strategy")
	}
}

func normalizeInstagramContentType(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func defaultString(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}

// GenerateInstagramImage exposes the source agent's text-to-image feature via
// a configurable OpenAI-compatible image endpoint. This keeps the deployed Go
// service portable while still allowing MFlux/FLUX gateways to be used.
func (h *Handler) GenerateInstagramImage(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var input instagramImageRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	input.Prompt = strings.TrimSpace(input.Prompt)
	if input.Prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if input.Height == 0 {
		input.Height = 1024
	}
	if input.Width == 0 {
		input.Width = 1024
	}
	if input.Height < 256 || input.Height > 2048 || input.Width < 256 || input.Width > 2048 {
		writeError(w, http.StatusBadRequest, "height and width must be between 256 and 2048")
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("LLM_API_KEY"))
	if apiKey == "" {
		writeError(w, http.StatusServiceUnavailable, "llm_not_configured")
		return
	}
	endpoint := strings.TrimSpace(os.Getenv("LLM_IMAGE_ENDPOINT"))
	if endpoint == "" {
		baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("LLM_BASE_URL")), "/")
		if baseURL == "" {
			baseURL = "http://localhost:3001/v1"
		}
		endpoint = baseURL + "/images/generations"
	}
	model := defaultString(os.Getenv("LLM_IMAGE_MODEL"), "schnell")
	payload := map[string]interface{}{
		"model":  model,
		"prompt": input.Prompt,
		"n":      1,
		"size":   strconv.Itoa(input.Width) + "x" + strconv.Itoa(input.Height),
	}
	if input.Seed != nil {
		payload["seed"] = *input.Seed
	}
	if input.Steps > 0 {
		payload["num_inference_steps"] = input.Steps
	}
	if input.Guidance > 0 {
		payload["guidance"] = input.Guidance
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "image_request_failed")
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := instagramAgentHTTPClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "image_generator_unreachable")
		return
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{"error": "image_generation_failed", "status": res.StatusCode, "details": truncate(string(b), 1200)})
		return
	}
	var result map[string]interface{}
	if err := json.Unmarshal(b, &result); err != nil {
		writeError(w, http.StatusBadGateway, "image_generator_invalid_response")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "model": model, "data": result["data"]})
}

func (h *Handler) GetInstagramAccount(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	userID := pathVar(r, "userId")
	tok, err := h.loadInstagramOAuth(r.Context(), userID)
	if err != nil {
		writeInstagramAgentOAuthError(w, err)
		return
	}
	result, err := instagramGraphGet(r.Context(), tok.IGBusinessID, url.Values{
		"fields":       {"id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website"},
		"access_token": {tok.AccessToken},
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) GetInstagramInsights(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	userID := pathVar(r, "userId")
	tok, err := h.loadInstagramOAuth(r.Context(), userID)
	if err != nil {
		writeInstagramAgentOAuthError(w, err)
		return
	}
	mediaID := strings.TrimSpace(r.URL.Query().Get("mediaId"))
	if mediaID != "" {
		result, err := getInstagramMediaInsights(r.Context(), tok, mediaID)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"scope": "media", "mediaId": mediaID, "metrics": result})
		return
	}

	period := defaultString(r.URL.Query().Get("period"), "day")
	if period != "day" && period != "week" && period != "days_28" {
		writeError(w, http.StatusBadRequest, "period must be day, week, or days_28")
		return
	}
	result, err := getInstagramAccountInsights(r.Context(), tok, period)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"scope": "account", "period": period, "metrics": result})
}

func (h *Handler) loadInstagramOAuth(ctx context.Context, userID string) (instagramOAuth, error) {
	if h == nil || h.db == nil || strings.TrimSpace(userID) == "" {
		return instagramOAuth{}, fmt.Errorf("not_connected")
	}
	var raw []byte
	if err := h.db.QueryRowContext(ctx, `SELECT value FROM public.user_settings WHERE user_id=$1 AND key='instagram_oauth' AND value IS NOT NULL`, userID).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return instagramOAuth{}, fmt.Errorf("not_connected")
		}
		return instagramOAuth{}, fmt.Errorf("instagram_settings_failed")
	}
	var tok instagramOAuth
	if err := json.Unmarshal(raw, &tok); err != nil {
		return instagramOAuth{}, fmt.Errorf("invalid_oauth_payload")
	}
	if strings.TrimSpace(tok.AccessToken) == "" || strings.TrimSpace(tok.IGBusinessID) == "" {
		return instagramOAuth{}, fmt.Errorf("not_connected")
	}
	return tok, nil
}

func writeInstagramAgentOAuthError(w http.ResponseWriter, err error) {
	if err != nil && err.Error() == "not_connected" {
		writeError(w, http.StatusConflict, "instagram_not_connected")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func instagramGraphGet(ctx context.Context, objectID string, query url.Values) (map[string]interface{}, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("META_GRAPH_BASE_URL")), "/")
	if base == "" {
		base = "https://graph.facebook.com/v24.0"
	}
	parts := strings.Split(strings.Trim(objectID, "/"), "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	endpoint := base + "/" + strings.Join(parts, "/")
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("instagram_request_failed")
	}
	req.Header.Set("Accept", "application/json")
	res, err := instagramAgentHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("instagram_unreachable")
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("instagram_api_failed: %s", truncate(extractFacebookErrorMessage(b, string(b)), 300))
	}
	var result map[string]interface{}
	if err := json.Unmarshal(b, &result); err != nil {
		return nil, fmt.Errorf("instagram_invalid_response")
	}
	return result, nil
}

func getInstagramMediaInsights(ctx context.Context, tok instagramOAuth, mediaID string) (map[string]interface{}, error) {
	media, err := instagramGraphGet(ctx, mediaID, url.Values{"fields": {"media_type"}, "access_token": {tok.AccessToken}})
	if err != nil {
		return nil, err
	}
	mediaType, _ := media["media_type"].(string)
	metrics := "impressions,reach,likes,comments,saves,shares"
	if strings.EqualFold(mediaType, "REELS") || strings.EqualFold(mediaType, "VIDEO") {
		metrics = "clips_replays_count,likes,comments,saves,shares,reach,views"
	}
	result, err := instagramGraphGet(ctx, mediaID+"/insights", url.Values{"metric": {metrics}, "access_token": {tok.AccessToken}})
	if err != nil {
		return nil, err
	}
	return flattenInstagramInsights(result), nil
}

func getInstagramAccountInsights(ctx context.Context, tok instagramOAuth, period string) (map[string]interface{}, error) {
	metrics := map[string]interface{}{}
	series, err := instagramGraphGet(ctx, tok.IGBusinessID+"/insights", url.Values{
		"metric": {"reach,follower_count"}, "period": {period}, "access_token": {tok.AccessToken},
	})
	if err != nil {
		return nil, err
	}
	for key, value := range flattenInstagramInsights(series) {
		metrics[key] = value
	}
	totals, err := instagramGraphGet(ctx, tok.IGBusinessID+"/insights", url.Values{
		"metric": {"profile_views,website_clicks,views"}, "period": {period}, "metric_type": {"total_value"}, "access_token": {tok.AccessToken},
	})
	if err != nil {
		return nil, err
	}
	for key, value := range flattenInstagramInsights(totals) {
		metrics[key] = value
	}
	return metrics, nil
}

func flattenInstagramInsights(payload map[string]interface{}) map[string]interface{} {
	result := map[string]interface{}{}
	items, _ := payload["data"].([]interface{})
	for _, raw := range items {
		item, _ := raw.(map[string]interface{})
		name, _ := item["name"].(string)
		if name == "" {
			continue
		}
		if total, ok := item["total_value"].(map[string]interface{}); ok {
			result[name] = total["value"]
			continue
		}
		values, _ := item["values"].([]interface{})
		if len(values) == 0 {
			result[name] = 0
			continue
		}
		last, _ := values[len(values)-1].(map[string]interface{})
		result[name] = last["value"]
	}
	return result
}
