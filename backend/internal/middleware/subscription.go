package middleware

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

// PlanLimits defines the limits for each plan
type PlanLimits struct {
	SocialAccounts   int `json:"social_accounts"`
	PostsPerMonth    int `json:"posts_per_month"` // -1 = unlimited
	Analytics        string `json:"analytics"`    // "basic", "advanced", "enterprise"
}

// SubscriptionEnforcer middleware that enforces subscription limits
type SubscriptionEnforcer struct {
	DB     *sql.DB
	Limits map[string]PlanLimits
}

// NewSubscriptionEnforcer creates a new subscription enforcer middleware
func NewSubscriptionEnforcer(db *sql.DB) *SubscriptionEnforcer {
	// Default limits - these could be loaded from database
	limits := map[string]PlanLimits{
		"free": {
			SocialAccounts: 5,
			PostsPerMonth:  100,
			Analytics:      "basic",
		},
		"pro": {
			SocialAccounts: 25,
			PostsPerMonth:  -1, // unlimited
			Analytics:      "advanced",
		},
		"enterprise": {
			SocialAccounts: -1, // unlimited
			PostsPerMonth:  -1, // unlimited
			Analytics:      "enterprise",
		},
	}

	return &SubscriptionEnforcer{
		DB:     db,
		Limits: limits,
	}
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
		if !se.checkLimits(r, planID) {
			se.respondLimitExceeded(w, planID)
			return
		}

		// Add plan info to request context
		ctx := context.WithValue(r.Context(), "user_plan", planID)
		ctx = context.WithValue(ctx, "plan_limits", se.Limits[planID])
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
func (se *SubscriptionEnforcer) checkLimits(r *http.Request, planID string) bool {
	limits := se.Limits[planID]

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
	limits := se.Limits[planID]

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusPaymentRequired) // 402 Payment Required

	response := map[string]interface{}{
		"error": "subscription_limit_exceeded",
		"message": "Your current plan has reached its limits",
		"plan": planID,
		"limits": limits,
		"upgrade_url": "/account/billing",
	}

	json.NewEncoder(w).Encode(response)
}
