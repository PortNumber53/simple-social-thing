package middleware

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
)

// PlanLimits defines the limits for each plan
type PlanLimits struct {
	SocialAccounts int    `json:"social_accounts"`
	PostsPerMonth  int    `json:"posts_per_month"` // -1 = unlimited
	Analytics      string `json:"analytics"`       // "basic", "advanced", "enterprise"
}

// SubscriptionEnforcer middleware that enforces subscription limits
type SubscriptionEnforcer struct {
	DB     *sql.DB
	Limits map[string]PlanLimits
	mu     sync.RWMutex
}

// NewSubscriptionEnforcer creates a new subscription enforcer middleware
func NewSubscriptionEnforcer(db *sql.DB) *SubscriptionEnforcer {
	return &SubscriptionEnforcer{
		DB:     db,
		Limits: map[string]PlanLimits{},
	}
}

func defaultPlanLimits(planID string) PlanLimits {
	// Conservative defaults; specific plans should be driven by billing_plans.limits.
	switch planID {
	case "enterprise":
		return PlanLimits{SocialAccounts: -1, PostsPerMonth: -1, Analytics: "enterprise"}
	case "pro":
		return PlanLimits{SocialAccounts: 25, PostsPerMonth: -1, Analytics: "advanced"}
	default:
		return PlanLimits{SocialAccounts: 5, PostsPerMonth: 100, Analytics: "basic"}
	}
}

func (se *SubscriptionEnforcer) getPlanLimits(planID string) PlanLimits {
	planID = strings.TrimSpace(strings.ToLower(planID))
	if planID == "" {
		planID = "free"
	}

	se.mu.RLock()
	if v, ok := se.Limits[planID]; ok {
		se.mu.RUnlock()
		return v
	}
	se.mu.RUnlock()

	// Load from DB.
	var limitsJSON sql.NullString
	err := se.DB.QueryRow(`
		SELECT limits
		FROM public.billing_plans
		WHERE id = $1
	`, planID).Scan(&limitsJSON)
	if err != nil || !limitsJSON.Valid || strings.TrimSpace(limitsJSON.String) == "" {
		v := defaultPlanLimits(planID)
		se.mu.Lock()
		se.Limits[planID] = v
		se.mu.Unlock()
		return v
	}

	var decoded PlanLimits
	if err := json.Unmarshal([]byte(limitsJSON.String), &decoded); err != nil {
		v := defaultPlanLimits(planID)
		se.mu.Lock()
		se.Limits[planID] = v
		se.mu.Unlock()
		return v
	}

	// Fill empty values with defaults so we don't accidentally enforce 0.
	def := defaultPlanLimits(planID)
	if decoded.SocialAccounts == 0 {
		decoded.SocialAccounts = def.SocialAccounts
	}
	if decoded.PostsPerMonth == 0 {
		decoded.PostsPerMonth = def.PostsPerMonth
	}
	if strings.TrimSpace(decoded.Analytics) == "" {
		decoded.Analytics = def.Analytics
	}

	se.mu.Lock()
	se.Limits[planID] = decoded
	se.mu.Unlock()
	return decoded
}

// Middleware returns an HTTP middleware that enforces subscription limits
func (se *SubscriptionEnforcer) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip middleware for certain routes that don't need enforcement
		if se.shouldSkip(r) {
			next.ServeHTTP(w, r)
			return
		}

		// Extract user ID from path or context
		userID := se.extractUserID(r)
		if userID == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Get user's plan
		planID, err := se.getUserPlan(userID)
		if err != nil {
			// If we can't determine the plan, default to free tier
			planID = "free"
		}

		// Check limits based on the request
		limits := se.getPlanLimits(planID)
		if !se.checkLimits(r, planID, limits) {
			se.respondLimitExceeded(w, planID)
			return
		}

		// Add plan info to request context
		ctx := context.WithValue(r.Context(), "user_plan", planID)
		ctx = context.WithValue(ctx, "plan_limits", limits)
		r = r.WithContext(ctx)

		next.ServeHTTP(w, r)
	})
}

// shouldSkip returns true if this route should skip subscription enforcement
func (se *SubscriptionEnforcer) shouldSkip(r *http.Request) bool {
	// Skip auth routes, billing routes, and public routes
	skipPaths := []string{
		"/api/users",
		"/api/billing",
		"/health",
		"/api/events",
	}

	for _, path := range skipPaths {
		if strings.HasPrefix(r.URL.Path, path) {
			return true
		}
	}

	return false
}

// extractUserID extracts the user ID from the request path
func (se *SubscriptionEnforcer) extractUserID(r *http.Request) string {
	// Look for user ID in path segments like /api/posts/user/{userId}
	parts := strings.Split(r.URL.Path, "/")
	for i, part := range parts {
		if part == "user" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

// getUserPlan returns the user's current plan
func (se *SubscriptionEnforcer) getUserPlan(userID string) (string, error) {
	var planID string
	err := se.DB.QueryRow(`
		SELECT COALESCE(plan_id, 'free') as plan_id
		FROM public.subscriptions
		WHERE user_id = $1 AND status = 'active'
	`, userID).Scan(&planID)

	if err == sql.ErrNoRows {
		return "free", nil // Default to free plan
	}

	return planID, err
}

// checkLimits checks if the request is within the plan limits
func (se *SubscriptionEnforcer) checkLimits(r *http.Request, planID string, limits PlanLimits) bool {

	// Example: Check social account limits for social connection endpoints
	if strings.Contains(r.URL.Path, "/social-connections") && r.Method == http.MethodPost {
		// Count current social connections for user
		userID := se.extractUserID(r)
		if userID != "" {
			var count int
			se.DB.QueryRow(`
				SELECT COUNT(*) FROM public.social_connections WHERE user_id = $1
			`, userID).Scan(&count)

			if limits.SocialAccounts >= 0 && count >= limits.SocialAccounts {
				return false
			}
		}
	}

	// Add more limit checks as needed for different endpoints
	// For example: posts per month, API rate limits, etc.

	return true
}

// respondLimitExceeded sends a limit exceeded response
func (se *SubscriptionEnforcer) respondLimitExceeded(w http.ResponseWriter, planID string) {
	limits := se.getPlanLimits(planID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusPaymentRequired) // 402 Payment Required

	response := map[string]interface{}{
		"error":       "subscription_limit_exceeded",
		"message":     "Your current plan has reached its limits",
		"plan":        planID,
		"limits":      limits,
		"upgrade_url": "/account/billing",
	}

	json.NewEncoder(w).Encode(response)
}
