package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/stripe/stripe-go/v79"
	"github.com/stripe/stripe-go/v79/client"
	"github.com/stripe/stripe-go/v79/webhook"
)

type BillingPlan struct {
	ID                   string                 `json:"id"`
	Name                 string                 `json:"name"`
	Description          *string                `json:"description,omitempty"`
	PriceCents           int                    `json:"priceCents"`
	Currency             string                 `json:"currency"`
	Interval             string                 `json:"interval"`
	StripePriceID        *string                `json:"stripePriceId,omitempty"`
	Features             map[string]interface{} `json:"features,omitempty"`
	Limits               map[string]interface{} `json:"limits,omitempty"`
	IsActive             bool                   `json:"isActive"`
	IsCustomPrice        bool                   `json:"isCustomPrice"`
	GracePeriodMonths    int                    `json:"gracePeriodMonths,omitempty"`
	ProductVersionGroup  *string                `json:"productVersionGroup,omitempty"`
	MigratedFromPlanID   *string                `json:"migratedFromPlanId,omitempty"`
	MigrationScheduledAt *time.Time             `json:"migrationScheduledAt,omitempty"`
}

type Subscription struct {
	ID                   string     `json:"id"`
	UserID               string     `json:"userId"`
	PlanID               string     `json:"planId"`
	StripeSubscriptionID *string    `json:"stripeSubscriptionId,omitempty"`
	StripeCustomerID     *string    `json:"stripeCustomerId,omitempty"`
	Status               string     `json:"status"`
	CurrentPeriodStart   *time.Time `json:"currentPeriodStart,omitempty"`
	CurrentPeriodEnd     *time.Time `json:"currentPeriodEnd,omitempty"`
	CancelAtPeriodEnd    bool       `json:"cancelAtPeriodEnd"`
	CanceledAt           *time.Time `json:"canceledAt,omitempty"`
	TrialStart           *time.Time `json:"trialStart,omitempty"`
	TrialEnd             *time.Time `json:"trialEnd,omitempty"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type PaymentMethod struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"userId"`
	StripePaymentMethodID string    `json:"stripePaymentMethodId"`
	Type                  string    `json:"type"`
	Last4                 *string   `json:"last4,omitempty"`
	Brand                 *string   `json:"brand,omitempty"`
	ExpMonth              *int      `json:"expMonth,omitempty"`
	ExpYear               *int      `json:"expYear,omitempty"`
	IsDefault             bool      `json:"isDefault"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type Invoice struct {
	ID               string     `json:"id"`
	UserID           string     `json:"userId"`
	StripeInvoiceID  string     `json:"stripeInvoiceId"`
	AmountDue        int        `json:"amountDue"`
	AmountPaid       int        `json:"amountPaid"`
	Currency         string     `json:"currency"`
	Status           string     `json:"status"`
	InvoicePDF       *string    `json:"invoicePdf,omitempty"`
	HostedInvoiceURL *string    `json:"hostedInvoiceUrl,omitempty"`
	PeriodStart      *time.Time `json:"periodStart,omitempty"`
	PeriodEnd        *time.Time `json:"periodEnd,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
}

type StripeProduct struct {
	ID              string                 `json:"id"`
	StripeProductID string                 `json:"stripeProductId"`
	Name            string                 `json:"name"`
	Description     *string                `json:"description,omitempty"`
	Active          bool                   `json:"active"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt       time.Time              `json:"createdAt"`
	UpdatedAt       time.Time              `json:"updatedAt"`
}

type CustomPlanRequest struct {
	ID                      string    `json:"id"`
	UserID                  string    `json:"userId"`
	RequestedSocialAccounts int       `json:"requestedSocialAccounts"`
	RequestedPostsPerMonth  int       `json:"requestedPostsPerMonth"`
	RequestedStorageGB      int       `json:"requestedStorageGb"`
	Notes                   *string   `json:"notes,omitempty"`
	Status                  string    `json:"status"`
	CreatedAt               time.Time `json:"createdAt"`
	UpdatedAt               time.Time `json:"updatedAt"`
}

func (h *Handler) isAdminUser(userID string) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return false
	}
	var ok bool
	err := h.db.QueryRow(`
		SELECT (
			COALESCE(profile->>'role', '') = 'admin'
			OR COALESCE(profile->>'adminLevel', '') = 'superuser'
			OR COALESCE((profile->'permissions'->>'billing')::boolean, false) = true
		)
		FROM public.users
		WHERE id = $1
	`, userID).Scan(&ok)
	if err != nil {
		return false
	}
	return ok
}

// Stripe client instance
var stripeClient *client.API

func initStripe() {
	if stripeClient != nil {
		return
	}

	secretKey := os.Getenv("STRIPE_SECRET_KEY")
	if secretKey == "" {
		log.Printf("[Billing] STRIPE_SECRET_KEY not set, Stripe features disabled")
		return
	}

	stripeClient = &client.API{}
	stripeClient.Init(secretKey, nil)
}

// GetBillingPlans returns available billing plans
func (h *Handler) GetBillingPlans(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	rows, err := h.db.Query(`
		SELECT id, name, description, price_cents, currency, interval, stripe_price_id, features, limits, is_active, is_custom_price
		FROM public.billing_plans
		WHERE is_active = true
		ORDER BY price_cents ASC
	`)
	if err != nil {
		log.Printf("[Billing][Plans] query error: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	var plans []BillingPlan
	for rows.Next() {
		var p BillingPlan
		var desc sql.NullString
		var stripePriceID sql.NullString
		var features, limits sql.NullString
		err := rows.Scan(&p.ID, &p.Name, &desc, &p.PriceCents, &p.Currency, &p.Interval, &stripePriceID, &features, &limits, &p.IsActive, &p.IsCustomPrice)
		if err != nil {
			log.Printf("[Billing][Plans] scan error: %v", err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		if desc.Valid {
			p.Description = &desc.String
		}
		if stripePriceID.Valid {
			p.StripePriceID = &stripePriceID.String
		}
		if features.Valid {
			var featuresMap map[string]interface{}
			if err := json.Unmarshal([]byte(features.String), &featuresMap); err == nil {
				p.Features = featuresMap
			}
		}
		if limits.Valid {
			var limitsMap map[string]interface{}
			if err := json.Unmarshal([]byte(limits.String), &limitsMap); err == nil {
				p.Limits = limitsMap
			}
		}

		plans = append(plans, p)
	}

	if err := rows.Err(); err != nil {
		log.Printf("[Billing][Plans] rows error: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, plans)
}

// CreateBillingPlan creates a billing plan in the database.
func (h *Handler) CreateBillingPlan(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	var req BillingPlan
	if err := decodeJSON(r, &req); err != nil {
		log.Printf("[Billing][CreatePlan] decode error: %v", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	req.ID = strings.TrimSpace(req.ID)
	if req.ID == "" {
		writeError(w, http.StatusBadRequest, "plan id is required")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "plan name is required")
		return
	}
	if req.PriceCents < 0 {
		writeError(w, http.StatusBadRequest, "price must be non-negative")
		return
	}
	if strings.TrimSpace(req.Currency) == "" {
		req.Currency = "usd"
	}
	if strings.TrimSpace(req.Interval) == "" {
		req.Interval = "month"
	}

	featuresJSON := "{}"
	if req.Features != nil {
		if jsonBytes, err := json.Marshal(req.Features); err == nil {
			featuresJSON = string(jsonBytes)
		}
	}

	limitsJSON := "{}"
	if req.Limits != nil {
		if jsonBytes, err := json.Marshal(req.Limits); err == nil {
			limitsJSON = string(jsonBytes)
		}
	}

	isActive := true
	if !req.IsActive {
		isActive = false
	}

	// Persist the plan first.
	_, err := h.db.Exec(`
		INSERT INTO public.billing_plans (
			id, name, description, price_cents, currency, interval,
			stripe_price_id, stripe_product_id,
			features, limits, is_active, is_custom_price,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			price_cents = EXCLUDED.price_cents,
			currency = EXCLUDED.currency,
			interval = EXCLUDED.interval,
			stripe_price_id = EXCLUDED.stripe_price_id,
			stripe_product_id = EXCLUDED.stripe_product_id,
			features = EXCLUDED.features,
			limits = EXCLUDED.limits,
			is_active = EXCLUDED.is_active,
			is_custom_price = EXCLUDED.is_custom_price,
			updated_at = NOW()
	`, req.ID, req.Name, req.Description, req.PriceCents, req.Currency, req.Interval, req.StripePriceID, nil, featuresJSON, limitsJSON, isActive, req.IsCustomPrice)
	if err != nil {
		log.Printf("[Billing][CreatePlan] insert error id=%s: %v", req.ID, err)
		writeError(w, http.StatusInternalServerError, "failed to create plan")
		return
	}

	// If this plan has a fixed price, create Stripe Product + Price immediately.
	// For custom priced plans, Stripe prices are created per-user at subscription time.
	stripeSynced := false
	var stripeErrStr string
	var createdStripeProductID, createdStripePriceID *string
	if !req.IsCustomPrice {
		initStripe()
		if stripeClient != nil {
			productParams := &stripe.ProductParams{
				Name: stripe.String(req.Name),
				Type: stripe.String(string(stripe.ProductTypeService)),
				Metadata: map[string]string{
					"internal": "simple-truvis-co",
					"plan_id":  req.ID,
				},
			}
			if req.Description != nil && *req.Description != "" {
				productParams.Description = stripe.String(*req.Description)
			}
			// Store limits JSON in product metadata.
			if limitsJSON != "{}" {
				productParams.Metadata["limits"] = limitsJSON
			}

			product, err := stripeClient.Products.New(productParams)
			if err != nil {
				stripeErrStr = err.Error()
				log.Printf("[Billing][CreatePlan] Stripe product create failed id=%s: %v", req.ID, err)
			} else {
				createdStripeProductID = &product.ID

				priceParams := &stripe.PriceParams{
					Product:    stripe.String(product.ID),
					UnitAmount: stripe.Int64(int64(req.PriceCents)),
					Currency:   stripe.String(req.Currency),
					Nickname:   stripe.String(req.Name),
					Recurring: &stripe.PriceRecurringParams{
						Interval: stripe.String(req.Interval),
					},
				}
				price, err := stripeClient.Prices.New(priceParams)
				if err != nil {
					stripeErrStr = err.Error()
					log.Printf("[Billing][CreatePlan] Stripe price create failed id=%s: %v", req.ID, err)
				} else {
					createdStripePriceID = &price.ID
					stripeSynced = true
					// Persist Stripe IDs back into billing_plans.
					if _, err := h.db.Exec(`
						UPDATE public.billing_plans
						SET stripe_price_id = $1, stripe_product_id = $2, updated_at = NOW()
						WHERE id = $3
					`, price.ID, product.ID, req.ID); err != nil {
						stripeSynced = false
						stripeErrStr = err.Error()
						log.Printf("[Billing][CreatePlan] failed to persist Stripe IDs for id=%s: %v", req.ID, err)
					}
				}
			}
		}
	}

	log.Printf("[Billing][CreatePlan] created/updated plan id=%s", req.ID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Plan created successfully",
		"plan": map[string]interface{}{
			"id":              req.ID,
			"name":            req.Name,
			"description":     req.Description,
			"priceCents":      req.PriceCents,
			"currency":        req.Currency,
			"interval":        req.Interval,
			"limits":          req.Limits,
			"isActive":        isActive,
			"isCustomPrice":   req.IsCustomPrice,
			"stripeProductId": createdStripeProductID,
			"stripePriceId":   createdStripePriceID,
			"stripeSynced":    stripeSynced,
		},
		"stripeError": stripeErrStr,
	})
}

// CreateCustomPlanRequest stores a user's request for a custom plan so admins can review it.
func (h *Handler) CreateCustomPlanRequest(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	userID := pathVar(r, "userId")
	if strings.TrimSpace(userID) == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var req struct {
		RequestedSocialAccounts int     `json:"requestedSocialAccounts"`
		RequestedPostsPerMonth  int     `json:"requestedPostsPerMonth"`
		RequestedStorageGB      int     `json:"requestedStorageGb"`
		Notes                   *string `json:"notes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.RequestedSocialAccounts < 0 || req.RequestedPostsPerMonth < 0 || req.RequestedStorageGB < 0 {
		writeError(w, http.StatusBadRequest, "requested values must be non-negative")
		return
	}

	requestID := fmt.Sprintf("cpr_%d", time.Now().UTC().UnixNano())
	_, err := h.db.Exec(`
		INSERT INTO public.custom_plan_requests (
			id, user_id, requested_social_accounts, requested_posts_per_month, requested_storage_gb,
			notes, status, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())
	`, requestID, userID, req.RequestedSocialAccounts, req.RequestedPostsPerMonth, req.RequestedStorageGB, req.Notes)
	if err != nil {
		log.Printf("[Billing][CustomPlanRequest] insert error userId=%s err=%v", userID, err)
		writeError(w, http.StatusInternalServerError, "failed to create request")
		return
	}

	// Notify admins.
	adminRows, err := h.db.Query(`
		SELECT id
		FROM public.users
		WHERE (profile ILIKE '%"role"%"admin"%' OR profile ILIKE '%"adminLevel"%"superuser"%')
	`)
	if err == nil {
		defer adminRows.Close()
		for adminRows.Next() {
			var adminID string
			if err := adminRows.Scan(&adminID); err != nil {
				continue
			}
			body := fmt.Sprintf(
				"User %s requested a custom plan. Social accounts: %d. Posts/month: %d. Storage (GB): %d.",
				userID,
				req.RequestedSocialAccounts,
				req.RequestedPostsPerMonth,
				req.RequestedStorageGB,
			)
			urlStr := "/admin/billing"
			h.createNotificationOnce(adminID, "billing.custom_plan_request", "Custom plan request", &body, &urlStr)
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"requestId": requestID,
		"status":    "pending",
	})
}

// GetCustomPlanRequests returns all custom plan requests (admin endpoint).
func (h *Handler) GetCustomPlanRequests(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	adminUserID := strings.TrimSpace(pathVar(r, "userId"))
	if adminUserID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}
	if !h.isAdminUser(adminUserID) {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))

	query := `
		SELECT id, user_id, requested_social_accounts, requested_posts_per_month, requested_storage_gb,
		       notes, status, created_at, updated_at
		FROM public.custom_plan_requests
	`
	args := []interface{}{}
	if statusFilter != "" {
		query += " WHERE status = $1"
		args = append(args, statusFilter)
	}
	query += " ORDER BY created_at DESC"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		log.Printf("[Billing][CustomPlanRequests] query error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to load requests")
		return
	}
	defer rows.Close()

	requests := []CustomPlanRequest{}
	for rows.Next() {
		var c CustomPlanRequest
		var notes sql.NullString
		if err := rows.Scan(
			&c.ID,
			&c.UserID,
			&c.RequestedSocialAccounts,
			&c.RequestedPostsPerMonth,
			&c.RequestedStorageGB,
			&notes,
			&c.Status,
			&c.CreatedAt,
			&c.UpdatedAt,
		); err != nil {
			log.Printf("[Billing][CustomPlanRequests] scan error: %v", err)
			writeError(w, http.StatusInternalServerError, "failed to load requests")
			return
		}
		if notes.Valid {
			c.Notes = &notes.String
		}
		requests = append(requests, c)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":  true,
		"requests": requests,
	})
}

// UpdateCustomPlanRequest updates status/notes for a custom plan request (admin endpoint).
func (h *Handler) UpdateCustomPlanRequest(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPut) {
		return
	}

	adminUserID := strings.TrimSpace(pathVar(r, "userId"))
	if adminUserID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}
	if !h.isAdminUser(adminUserID) {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	requestID := strings.TrimSpace(pathVar(r, "requestId"))
	if requestID == "" {
		writeError(w, http.StatusBadRequest, "requestId is required")
		return
	}

	var req struct {
		Status string  `json:"status"`
		Notes  *string `json:"notes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	status := strings.TrimSpace(req.Status)
	if status == "" {
		writeError(w, http.StatusBadRequest, "status is required")
		return
	}

	allowed := map[string]bool{
		"pending":   true,
		"reviewing": true,
		"approved":  true,
		"rejected":  true,
	}
	if !allowed[strings.ToLower(status)] {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}

	_, err := h.db.Exec(`
		UPDATE public.custom_plan_requests
		SET status = $2,
		    notes = COALESCE($3, notes),
		    updated_at = NOW()
		WHERE id = $1
	`, requestID, strings.ToLower(status), req.Notes)
	if err != nil {
		log.Printf("[Billing][CustomPlanRequests] update error requestId=%s err=%v", requestID, err)
		writeError(w, http.StatusInternalServerError, "failed to update request")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// ApproveCustomPlanRequest approves a request and assigns a per-user plan custom_<userId> (admin endpoint).
func (h *Handler) ApproveCustomPlanRequest(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	adminUserID := strings.TrimSpace(pathVar(r, "userId"))
	if adminUserID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}
	if !h.isAdminUser(adminUserID) {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	requestID := strings.TrimSpace(pathVar(r, "requestId"))
	if requestID == "" {
		writeError(w, http.StatusBadRequest, "requestId is required")
		return
	}

	var req struct {
		PriceCents int                    `json:"priceCents"`
		Currency   string                 `json:"currency"`
		Interval   string                 `json:"interval"`
		Limits     map[string]interface{} `json:"limits"`
		Notes      *string                `json:"notes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.PriceCents < 0 {
		writeError(w, http.StatusBadRequest, "priceCents must be non-negative")
		return
	}
	currency := strings.TrimSpace(strings.ToLower(req.Currency))
	if currency == "" {
		currency = "usd"
	}
	interval := strings.TrimSpace(strings.ToLower(req.Interval))
	if interval == "" {
		interval = "month"
	}
	if interval != "month" && interval != "year" {
		writeError(w, http.StatusBadRequest, "interval must be month or year")
		return
	}

	// Load request to get target user.
	var targetUserID string
	err := h.db.QueryRow(`
		SELECT user_id
		FROM public.custom_plan_requests
		WHERE id = $1
	`, requestID).Scan(&targetUserID)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "request not found")
		return
	}
	if err != nil {
		log.Printf("[Billing][CustomPlanRequests] load error requestId=%s err=%v", requestID, err)
		writeError(w, http.StatusInternalServerError, "failed to load request")
		return
	}

	planID := fmt.Sprintf("custom_%s", targetUserID)
	planName := "Custom Plan"
	planDesc := fmt.Sprintf("Custom plan for user %s", targetUserID)
	limitsJSON, _ := json.Marshal(req.Limits)

	// Upsert plan.
	_, err = h.db.Exec(`
		INSERT INTO public.billing_plans (
			id, name, description, price_cents, currency, interval, stripe_price_id, features, limits, is_active, is_custom_price,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, NULL, NULL, $7::jsonb, true, true,
			NOW(), NOW()
		)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			price_cents = EXCLUDED.price_cents,
			currency = EXCLUDED.currency,
			interval = EXCLUDED.interval,
			limits = EXCLUDED.limits,
			is_active = true,
			is_custom_price = true,
			updated_at = NOW()
	`, planID, planName, planDesc, req.PriceCents, currency, interval, string(limitsJSON))
	if err != nil {
		log.Printf("[Billing][CustomPlanRequests] plan upsert error requestId=%s planId=%s err=%v", requestID, planID, err)
		writeError(w, http.StatusInternalServerError, "failed to create plan")
		return
	}

	// If the user already has a Stripe subscription, update its price so Stripe reflects the approved amount.
	// Stripe prices are immutable, so this creates a new Price under the plan's Product and swaps the subscription item.
	stripeUpdated := false
	stripePriceID := ""
	stripeUpdateError := ""
	initStripe()
	if stripeClient != nil {
		var stripeProductID sql.NullString
		var stripeSubID sql.NullString
		err := h.db.QueryRow(`
			SELECT bp.stripe_product_id, s.stripe_subscription_id
			FROM public.billing_plans bp
			LEFT JOIN public.subscriptions s ON s.user_id = $1
			WHERE bp.id = $2
		`, targetUserID, planID).Scan(&stripeProductID, &stripeSubID)
		if err == nil {
			productID := ""
			if stripeProductID.Valid {
				productID = strings.TrimSpace(stripeProductID.String)
			}
			if productID == "" {
				productParams := &stripe.ProductParams{
					Name: stripe.String(planName),
					Type: stripe.String(string(stripe.ProductTypeService)),
					Metadata: map[string]string{
						"internal": "simple-truvis-co",
						"plan_id":  planID,
					},
				}
				product, pErr := stripeClient.Products.New(productParams)
				if pErr != nil {
					stripeUpdateError = "stripe product create failed: " + pErr.Error()
				} else if product != nil {
					productID = product.ID
					_, _ = h.db.Exec(`
						UPDATE public.billing_plans
						SET stripe_product_id = $1, updated_at = NOW()
						WHERE id = $2
					`, productID, planID)
				}
			}

			if productID != "" {
				priceParams := &stripe.PriceParams{
					Product:    stripe.String(productID),
					UnitAmount: stripe.Int64(int64(req.PriceCents)),
					Currency:   stripe.String(currency),
					Nickname:   stripe.String(planName),
					Recurring: &stripe.PriceRecurringParams{
						Interval: stripe.String(interval),
					},
				}
				price, prErr := stripeClient.Prices.New(priceParams)
				if prErr != nil {
					stripeUpdateError = "stripe price create failed: " + prErr.Error()
				} else if price != nil {
					stripePriceID = price.ID
					_, _ = h.db.Exec(`
						UPDATE public.billing_plans
						SET stripe_price_id = $1, stripe_product_id = $2, updated_at = NOW()
						WHERE id = $3
					`, price.ID, productID, planID)

					if stripeSubID.Valid && strings.TrimSpace(stripeSubID.String) != "" {
						stripeSub, sErr := stripeClient.Subscriptions.Get(stripeSubID.String, &stripe.SubscriptionParams{
							Expand: []*string{stripe.String("items")},
						})
						if sErr != nil {
							stripeUpdateError = "stripe subscription load failed: " + sErr.Error()
						} else if stripeSub != nil && stripeSub.Status != stripe.SubscriptionStatusCanceled {
							itemID := ""
							if stripeSub.Items != nil && len(stripeSub.Items.Data) > 0 {
								itemID = stripeSub.Items.Data[0].ID
							}
							if strings.TrimSpace(itemID) == "" {
								stripeUpdateError = "stripe subscription has no items"
							} else {
								updateParams := &stripe.SubscriptionParams{
									Items: []*stripe.SubscriptionItemsParams{
										{
											ID:    stripe.String(itemID),
											Price: stripe.String(price.ID),
										},
									},
									ProrationBehavior: stripe.String("none"),
								}
								updated, uErr := stripeClient.Subscriptions.Update(stripeSubID.String, updateParams)
								if uErr != nil {
									stripeUpdateError = "stripe subscription update failed: " + uErr.Error()
								} else if updated != nil {
									stripeUpdated = true
									var canceledAt *time.Time
									if updated.CanceledAt != 0 {
										t := time.Unix(updated.CanceledAt, 0)
										canceledAt = &t
									}
									var cps *time.Time
									var cpe *time.Time
									if updated.CurrentPeriodStart != 0 {
										t := time.Unix(updated.CurrentPeriodStart, 0)
										cps = &t
									}
									if updated.CurrentPeriodEnd != 0 {
										t := time.Unix(updated.CurrentPeriodEnd, 0)
										cpe = &t
									}
									if string(updated.Status) != string(stripe.SubscriptionStatusCanceled) {
										canceledAt = nil
									}
									_, _ = h.db.Exec(`
										UPDATE public.subscriptions
										SET status = $2,
											current_period_start = COALESCE($3, current_period_start),
											current_period_end = COALESCE($4, current_period_end),
											cancel_at_period_end = $5,
											canceled_at = $6,
											updated_at = NOW()
										WHERE user_id = $1
									`, targetUserID, string(updated.Status), cps, cpe, updated.CancelAtPeriodEnd, canceledAt)
								}
							}
						}
					}
				}
			}
		}
	}

	// Upsert subscription to point at the new plan.
	subscriptionID := fmt.Sprintf("sub_custom_%s", targetUserID)
	_, err = h.db.Exec(`
		INSERT INTO public.subscriptions (
			id, user_id, plan_id, stripe_subscription_id, stripe_customer_id, status,
			current_period_start, current_period_end, cancel_at_period_end, canceled_at,
			trial_start, trial_end, created_at, updated_at
		) VALUES (
			$1, $2, $3, NULL, NULL, 'active',
			NOW(), NOW() + interval '30 days', false, NULL,
			NULL, NULL, NOW(), NOW()
		)
		ON CONFLICT (user_id) DO UPDATE SET
			plan_id = EXCLUDED.plan_id,
			status = 'active',
			cancel_at_period_end = false,
			canceled_at = NULL,
			updated_at = NOW()
	`, subscriptionID, targetUserID, planID)
	if err != nil {
		log.Printf("[Billing][CustomPlanRequests] subscription upsert error requestId=%s userId=%s err=%v", requestID, targetUserID, err)
		writeError(w, http.StatusInternalServerError, "failed to assign plan")
		return
	}

	// Mark request approved.
	_, err = h.db.Exec(`
		UPDATE public.custom_plan_requests
		SET status = 'approved',
		    notes = COALESCE($2, notes),
		    updated_at = NOW()
		WHERE id = $1
	`, requestID, req.Notes)
	if err != nil {
		log.Printf("[Billing][CustomPlanRequests] approve update error requestId=%s err=%v", requestID, err)
		writeError(w, http.StatusInternalServerError, "failed to mark request approved")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":                   true,
		"requestId":                 requestID,
		"userId":                    targetUserID,
		"assignedPlanId":            planID,
		"stripePriceId":             stripePriceID,
		"updatedStripeSubscription": stripeUpdated,
		"stripeUpdateError":         stripeUpdateError,
	})
}

// FixSubscriptionAmount allows an admin to correct a user's custom plan price and optionally update Stripe.
func (h *Handler) FixSubscriptionAmount(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	adminUserID := strings.TrimSpace(pathVar(r, "userId"))
	if !h.isAdminUser(adminUserID) {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	targetUserID := strings.TrimSpace(pathVar(r, "targetUserId"))
	if targetUserID == "" {
		writeError(w, http.StatusBadRequest, "targetUserId is required")
		return
	}

	var req struct {
		PriceCents int     `json:"priceCents"`
		Currency   string  `json:"currency"`
		Interval   string  `json:"interval"`
		ApplyToSub bool    `json:"applyToSubscription"`
		Proration  *string `json:"prorationBehavior,omitempty"` // e.g. "none", "create_prorations", "always_invoice"
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.PriceCents < 0 {
		writeError(w, http.StatusBadRequest, "priceCents must be non-negative")
		return
	}
	if strings.TrimSpace(req.Currency) == "" {
		req.Currency = "usd"
	}
	if strings.TrimSpace(req.Interval) == "" {
		req.Interval = "month"
	}
	interval := strings.TrimSpace(strings.ToLower(req.Interval))
	if interval == "" {
		interval = "month"
	}

	planID := fmt.Sprintf("custom_%s", targetUserID)

	// Load current plan + subscription (if any)
	var planName string
	var stripeProductID sql.NullString
	var stripeSubID sql.NullString
	err := h.db.QueryRow(`
		SELECT bp.name, bp.stripe_product_id,
		       s.stripe_subscription_id
		FROM public.billing_plans bp
		LEFT JOIN public.subscriptions s ON s.user_id = $1
		WHERE bp.id = $2
	`, targetUserID, planID).Scan(&planName, &stripeProductID, &stripeSubID)
	if err != nil {
		log.Printf("[Billing][FixSubscriptionAmount] plan lookup error adminUserId=%s targetUserId=%s planId=%s: %v", adminUserID, targetUserID, planID, err)
		writeError(w, http.StatusNotFound, "custom plan not found")
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	// Ensure Stripe product exists (create if missing)
	productID := ""
	if stripeProductID.Valid {
		productID = strings.TrimSpace(stripeProductID.String)
	}
	if productID == "" {
		productParams := &stripe.ProductParams{
			Name: stripe.String(planName),
			Type: stripe.String(string(stripe.ProductTypeService)),
			Metadata: map[string]string{
				"internal": "simple-truvis-co",
				"plan_id":  planID,
			},
		}
		product, err := stripeClient.Products.New(productParams)
		if err != nil {
			log.Printf("[Billing][FixSubscriptionAmount] Stripe product create failed planId=%s: %v", planID, err)
			writeError(w, http.StatusInternalServerError, "Failed to configure plan")
			return
		}
		productID = product.ID
		if _, err := h.db.Exec(`
			UPDATE public.billing_plans
			SET stripe_product_id = $1, updated_at = NOW()
			WHERE id = $2
		`, productID, planID); err != nil {
			log.Printf("[Billing][FixSubscriptionAmount] failed to persist Stripe product id planId=%s: %v", planID, err)
			writeError(w, http.StatusInternalServerError, "Failed to configure plan")
			return
		}
	}

	// Create a new Stripe price for the updated amount.
	priceParams := &stripe.PriceParams{
		Product:    stripe.String(productID),
		UnitAmount: stripe.Int64(int64(req.PriceCents)),
		Currency:   stripe.String(strings.ToLower(req.Currency)),
		Nickname:   stripe.String(planName),
		Recurring: &stripe.PriceRecurringParams{
			Interval: stripe.String(interval),
		},
	}
	price, err := stripeClient.Prices.New(priceParams)
	if err != nil {
		log.Printf("[Billing][FixSubscriptionAmount] Stripe price create failed planId=%s: %v", planID, err)
		writeError(w, http.StatusInternalServerError, "Failed to configure plan")
		return
	}

	// Persist updated amount + new stripe_price_id.
	if _, err := h.db.Exec(`
		UPDATE public.billing_plans
		SET price_cents = $1,
			currency = $2,
			interval = $3,
			stripe_price_id = $4,
			updated_at = NOW()
		WHERE id = $5
	`, req.PriceCents, strings.ToLower(req.Currency), interval, price.ID, planID); err != nil {
		log.Printf("[Billing][FixSubscriptionAmount] plan update error planId=%s: %v", planID, err)
		writeError(w, http.StatusInternalServerError, "Failed to update plan")
		return
	}

	updatedStripeSubscription := false
	if req.ApplyToSub && stripeSubID.Valid && strings.TrimSpace(stripeSubID.String) != "" {
		stripeSub, err := stripeClient.Subscriptions.Get(stripeSubID.String, &stripe.SubscriptionParams{
			Expand: []*string{stripe.String("items")},
		})
		if err != nil {
			log.Printf("[Billing][FixSubscriptionAmount] Stripe get subscription failed targetUserId=%s stripeSubId=%s: %v", targetUserID, stripeSubID.String, err)
			writeError(w, http.StatusInternalServerError, "Failed to load subscription")
			return
		}
		if stripeSub != nil && stripeSub.Status != stripe.SubscriptionStatusCanceled {
			itemID := ""
			if stripeSub.Items != nil && len(stripeSub.Items.Data) > 0 {
				itemID = stripeSub.Items.Data[0].ID
			}
			if strings.TrimSpace(itemID) == "" {
				writeError(w, http.StatusInternalServerError, "Stripe subscription has no items")
				return
			}

			params := &stripe.SubscriptionParams{
				Items: []*stripe.SubscriptionItemsParams{
					{
						ID:    stripe.String(itemID),
						Price: stripe.String(price.ID),
					},
				},
			}
			proration := "none"
			if req.Proration != nil && strings.TrimSpace(*req.Proration) != "" {
				proration = strings.TrimSpace(*req.Proration)
			}
			params.ProrationBehavior = stripe.String(proration)

			updated, err := stripeClient.Subscriptions.Update(stripeSubID.String, params)
			if err != nil {
				log.Printf("[Billing][FixSubscriptionAmount] Stripe subscription update failed targetUserId=%s stripeSubId=%s: %v", targetUserID, stripeSubID.String, err)
				writeError(w, http.StatusInternalServerError, "Failed to update subscription")
				return
			}
			updatedStripeSubscription = true

			// Sync DB subscription status/period fields from Stripe.
			var canceledAt *time.Time
			if updated.CanceledAt != 0 {
				t := time.Unix(updated.CanceledAt, 0)
				canceledAt = &t
			}
			var cps *time.Time
			var cpe *time.Time
			if updated.CurrentPeriodStart != 0 {
				t := time.Unix(updated.CurrentPeriodStart, 0)
				cps = &t
			}
			if updated.CurrentPeriodEnd != 0 {
				t := time.Unix(updated.CurrentPeriodEnd, 0)
				cpe = &t
			}
			if string(updated.Status) != string(stripe.SubscriptionStatusCanceled) {
				canceledAt = nil
			}

			if _, err := h.db.Exec(`
				UPDATE public.subscriptions
				SET status = $2,
					current_period_start = COALESCE($3, current_period_start),
					current_period_end = COALESCE($4, current_period_end),
					cancel_at_period_end = $5,
					canceled_at = $6,
					updated_at = NOW()
				WHERE user_id = $1
			`, targetUserID, string(updated.Status), cps, cpe, updated.CancelAtPeriodEnd, canceledAt); err != nil {
				log.Printf("[Billing][FixSubscriptionAmount] DB subscription sync failed targetUserId=%s: %v", targetUserID, err)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":                   true,
		"targetUserId":              targetUserID,
		"planId":                    planID,
		"stripeProductId":           productID,
		"stripePriceId":             price.ID,
		"updatedStripeSubscription": updatedStripeSubscription,
	})
}

// GetUserSubscription returns the current user's subscription
func (h *Handler) GetUserSubscription(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var sub Subscription
	var stripeSubID, stripeCustID sql.NullString
	var periodStart, periodEnd, canceledAt, trialStart, trialEnd sql.NullTime

	err := h.db.QueryRow(`
		SELECT id, user_id, COALESCE(NULLIF(plan_id, ''), 'free') as plan_id, stripe_subscription_id, stripe_customer_id, status,
		       current_period_start, current_period_end, cancel_at_period_end, canceled_at,
		       trial_start, trial_end, created_at, updated_at
		FROM public.subscriptions
		WHERE user_id = $1
	`, userID).Scan(
		&sub.ID, &sub.UserID, &sub.PlanID, &stripeSubID, &stripeCustID, &sub.Status,
		&periodStart, &periodEnd, &sub.CancelAtPeriodEnd, &canceledAt,
		&trialStart, &trialEnd, &sub.CreatedAt, &sub.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		// No subscription found, return free plan
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"planId":   "free",
			"status":   "active",
			"isActive": true,
		})
		return
	}

	if err != nil {
		log.Printf("[Billing][Subscription] query error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Inline nullStringPtr logic
	stripeSubIDPtr := (*string)(nil)
	if stripeSubID.Valid {
		stripeSubIDPtr = &stripeSubID.String
	}
	stripeCustIDPtr := (*string)(nil)
	if stripeCustID.Valid {
		stripeCustIDPtr = &stripeCustID.String
	}

	sub.StripeSubscriptionID = stripeSubIDPtr
	sub.StripeCustomerID = stripeCustIDPtr
	sub.CurrentPeriodStart = inlineNullTimePtr(periodStart)
	sub.CurrentPeriodEnd = inlineNullTimePtr(periodEnd)
	sub.CanceledAt = inlineNullTimePtr(canceledAt)
	sub.TrialStart = inlineNullTimePtr(trialStart)
	sub.TrialEnd = inlineNullTimePtr(trialEnd)

	writeJSON(w, http.StatusOK, sub)
}

// CreateSubscription creates a new subscription for a user
func (h *Handler) CreateSubscription(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var req struct {
		PlanID          string  `json:"planId"`
		PaymentMethodID string  `json:"paymentMethodId"`
		PromotionCode   *string `json:"promotionCode,omitempty"`
		TrialDays       *int    `json:"trialDays,omitempty"`
	}

	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.PlanID == "" {
		writeError(w, http.StatusBadRequest, "planId is required")
		return
	}

	if req.PlanID == "free" {
		// Handle free plan - just update or create subscription record
		_, err := h.db.Exec(`
			INSERT INTO public.subscriptions (id, user_id, plan_id, status)
			VALUES (gen_random_uuid()::text, $1, $2, 'active')
			ON CONFLICT (user_id) DO UPDATE SET
				plan_id = EXCLUDED.plan_id,
				status = 'active',
				updated_at = NOW()
		`, userID, req.PlanID)

		if err != nil {
			log.Printf("[Billing][CreateSubscription] free plan error userId=%s: %v", userID, err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
		return
	}

	// Handle paid plans with Stripe
	// First, get the plan details
	var plan BillingPlan
	var isCustomPrice bool
	var stripeProductID sql.NullString
	err := h.db.QueryRow(`
		SELECT id, name, price_cents, currency, interval, stripe_price_id, is_custom_price, stripe_product_id
		FROM public.billing_plans
		WHERE id = $1 AND is_active = true
	`, req.PlanID).Scan(&plan.ID, &plan.Name, &plan.PriceCents, &plan.Currency, &plan.Interval, &plan.StripePriceID, &isCustomPrice, &stripeProductID)

	if err != nil {
		log.Printf("[Billing][CreateSubscription] plan lookup error userId=%s planId=%s: %v", userID, req.PlanID, err)
		writeError(w, http.StatusBadRequest, "Invalid plan")
		return
	}

	if plan.StripePriceID == nil || *plan.StripePriceID == "" {
		// For custom priced plans, we may not have created a Stripe product/price yet.
		// Create them lazily so the user can complete checkout.
		if !isCustomPrice {
			writeError(w, http.StatusBadRequest, "Plan not configured for payment")
			return
		}
		initStripe()
		if stripeClient == nil {
			writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
			return
		}

		productID := ""
		if stripeProductID.Valid {
			productID = stripeProductID.String
		}
		if strings.TrimSpace(productID) == "" {
			productParams := &stripe.ProductParams{
				Name: stripe.String(plan.Name),
				Type: stripe.String(string(stripe.ProductTypeService)),
				Metadata: map[string]string{
					"internal": "simple-truvis-co",
					"plan_id":  plan.ID,
				},
			}
			product, err := stripeClient.Products.New(productParams)
			if err != nil {
				log.Printf("[Billing][CreateSubscription] Stripe product create failed planId=%s: %v", plan.ID, err)
				writeError(w, http.StatusInternalServerError, "Failed to configure plan")
				return
			}
			productID = product.ID
		}

		interval := strings.TrimSpace(strings.ToLower(plan.Interval))
		if interval == "" {
			interval = "month"
		}
		priceParams := &stripe.PriceParams{
			Product:    stripe.String(productID),
			UnitAmount: stripe.Int64(int64(plan.PriceCents)),
			Currency:   stripe.String(plan.Currency),
			Nickname:   stripe.String(plan.Name),
			Recurring: &stripe.PriceRecurringParams{
				Interval: stripe.String(interval),
			},
		}
		price, err := stripeClient.Prices.New(priceParams)
		if err != nil {
			log.Printf("[Billing][CreateSubscription] Stripe price create failed planId=%s: %v", plan.ID, err)
			writeError(w, http.StatusInternalServerError, "Failed to configure plan")
			return
		}

		// Persist Stripe IDs back into billing_plans.
		if _, err := h.db.Exec(`
			UPDATE public.billing_plans
			SET stripe_price_id = $1, stripe_product_id = $2, updated_at = NOW()
			WHERE id = $3
		`, price.ID, productID, plan.ID); err != nil {
			log.Printf("[Billing][CreateSubscription] failed to persist Stripe IDs planId=%s: %v", plan.ID, err)
			writeError(w, http.StatusInternalServerError, "Failed to configure plan")
			return
		}
		plan.StripePriceID = &price.ID
	}

	// Check if user already has a subscription row.
	// If it exists but has no Stripe subscription yet, we allow this call to "finalize" payment.
	var existingSubID string
	var existingStripeSubID sql.NullString
	var existingStripeCustomerID sql.NullString
	err = h.db.QueryRow(`
		SELECT id, stripe_subscription_id, stripe_customer_id
		FROM public.subscriptions
		WHERE user_id = $1
	`, userID).Scan(&existingSubID, &existingStripeSubID, &existingStripeCustomerID)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("[Billing][CreateSubscription] subscription check error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err == nil {
		if existingStripeSubID.Valid && strings.TrimSpace(existingStripeSubID.String) != "" {
			// If the Stripe subscription is canceled, allow re-subscribing.
			stripeSub, getErr := stripeClient.Subscriptions.Get(existingStripeSubID.String, nil)
			if getErr != nil {
				log.Printf("[Billing][CreateSubscription] Stripe get error userId=%s stripeSubId=%s: %v", userID, existingStripeSubID.String, getErr)
				writeError(w, http.StatusBadRequest, "User already has an active subscription")
				return
			}
			if stripeSub != nil && stripeSub.Status != stripe.SubscriptionStatusCanceled {
				writeError(w, http.StatusBadRequest, "User already has an active subscription")
				return
			}
		}
	}

	// Create Stripe customer and subscription
	// Get or create Stripe customer
	var customerID string
	if existingStripeCustomerID.Valid && strings.TrimSpace(existingStripeCustomerID.String) != "" {
		customerID = existingStripeCustomerID.String
	} else {
		customerParams := &stripe.CustomerParams{
			Email: stripe.String(fmt.Sprintf("user-%s@example.com", userID)), // TODO: Get real email from user
		}
		customer, err := stripeClient.Customers.New(customerParams)
		if err != nil {
			log.Printf("[Billing][CreateSubscription] customer creation error userId=%s: %v", userID, err)
			writeError(w, http.StatusInternalServerError, "Failed to create customer")
			return
		}
		customerID = customer.ID
	}

	// Attach payment method to customer
	if req.PaymentMethodID != "" {
		_, err = stripeClient.PaymentMethods.Attach(req.PaymentMethodID, &stripe.PaymentMethodAttachParams{
			Customer: stripe.String(customerID),
		})
		if err != nil {
			log.Printf("[Billing][CreateSubscription] payment method attach error userId=%s: %v", userID, err)
			writeError(w, http.StatusBadRequest, "Invalid payment method")
			return
		}

		// Set as default payment method
		_, err = stripeClient.Customers.Update(customerID, &stripe.CustomerParams{
			InvoiceSettings: &stripe.CustomerInvoiceSettingsParams{
				DefaultPaymentMethod: stripe.String(req.PaymentMethodID),
			},
		})
		if err != nil {
			log.Printf("[Billing][CreateSubscription] default payment method error userId=%s: %v", userID, err)
		}
	}

	// Create subscription
	subscriptionParams := &stripe.SubscriptionParams{
		Customer: stripe.String(customerID),
		Items: []*stripe.SubscriptionItemsParams{
			{
				Price: stripe.String(*plan.StripePriceID),
			},
		},
		PaymentBehavior: stripe.String("default_incomplete"),
		Expand:          []*string{stripe.String("latest_invoice.payment_intent")},
	}

	if req.TrialDays != nil && *req.TrialDays > 0 {
		subscriptionParams.TrialPeriodDays = stripe.Int64(int64(*req.TrialDays))
	}

	subscription, err := stripeClient.Subscriptions.New(subscriptionParams)
	if err != nil {
		log.Printf("[Billing][CreateSubscription] subscription creation error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, "Failed to create subscription")
		return
	}

	// Save subscription to database
	periodStart := time.Unix(subscription.CurrentPeriodStart, 0)
	periodEnd := time.Unix(subscription.CurrentPeriodEnd, 0)
	if strings.TrimSpace(existingSubID) != "" {
		_, err = h.db.Exec(`
			UPDATE public.subscriptions
			SET plan_id = $2,
				stripe_subscription_id = $3,
				stripe_customer_id = $4,
				status = $5,
				current_period_start = $6,
				current_period_end = $7,
				cancel_at_period_end = false,
				canceled_at = NULL,
				updated_at = NOW()
			WHERE id = $1
		`, existingSubID, req.PlanID, subscription.ID, customerID, subscription.Status, periodStart, periodEnd)
	} else {
		subID := fmt.Sprintf("sub_%s", subscription.ID)
		existingSubID = subID
		_, err = h.db.Exec(`
			INSERT INTO public.subscriptions (
				id, user_id, plan_id, stripe_subscription_id, stripe_customer_id, status,
				current_period_start, current_period_end, created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		`, subID, userID, req.PlanID, subscription.ID, customerID, subscription.Status, periodStart, periodEnd)
	}

	if err != nil {
		log.Printf("[Billing][CreateSubscription] database save error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Return subscription data with client secret for payment confirmation
	response := map[string]interface{}{
		"subscriptionId":       existingSubID,
		"stripeSubscriptionId": subscription.ID,
		"clientSecret":         subscription.LatestInvoice.PaymentIntent.ClientSecret,
		"status":               subscription.Status,
	}

	writeJSON(w, http.StatusOK, response)
}

// CancelSubscription cancels a user's subscription
func (h *Handler) CancelSubscription(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	var req struct {
		CancelAtPeriodEnd bool `json:"cancelAtPeriodEnd"`
	}

	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Get current subscription
	var stripeSubID string
	err := h.db.QueryRow(`
		SELECT stripe_subscription_id
		FROM public.subscriptions
		WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL
	`, userID).Scan(&stripeSubID)

	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "No active subscription found")
		return
	}

	if err != nil {
		log.Printf("[Billing][CancelSubscription] query error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cancel in Stripe
	stripeSub, err := stripeClient.Subscriptions.Get(stripeSubID, nil)
	if err != nil {
		log.Printf("[Billing][CancelSubscription] Stripe get error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, "Failed to load subscription")
		return
	}

	// Stripe does not allow updating an already-canceled subscription.
	stripeIsCanceled := stripeSub != nil && stripeSub.Status == stripe.SubscriptionStatusCanceled
	if stripeIsCanceled {
		if !req.CancelAtPeriodEnd {
			writeError(w, http.StatusBadRequest, "Subscription is already canceled. Please subscribe again.")
			return
		}
		// If the user is requesting cancellation and Stripe already canceled it, treat this as a no-op.
	} else {
		updateParams := &stripe.SubscriptionParams{
			CancelAtPeriodEnd: stripe.Bool(req.CancelAtPeriodEnd),
		}
		stripeSub, err = stripeClient.Subscriptions.Update(stripeSubID, updateParams)
		if err != nil {
			log.Printf("[Billing][CancelSubscription] Stripe update error userId=%s: %v", userID, err)
			writeError(w, http.StatusInternalServerError, "Failed to update subscription: "+err.Error())
			return
		}
	}

	// Use Stripe as the source of truth for persisted state.
	// Note: Stripe may keep current_period_end even for canceled subscriptions.
	var canceledAt *time.Time
	if stripeSub != nil && stripeSub.CanceledAt != 0 {
		t := time.Unix(stripeSub.CanceledAt, 0)
		canceledAt = &t
	}

	stripeStatus := ""
	stripeCancelAtPeriodEnd := false
	var currentPeriodStart *time.Time
	var currentPeriodEnd *time.Time
	if stripeSub != nil {
		stripeStatus = string(stripeSub.Status)
		stripeCancelAtPeriodEnd = stripeSub.CancelAtPeriodEnd
		if stripeSub.CurrentPeriodStart != 0 {
			t := time.Unix(stripeSub.CurrentPeriodStart, 0)
			currentPeriodStart = &t
		}
		if stripeSub.CurrentPeriodEnd != 0 {
			t := time.Unix(stripeSub.CurrentPeriodEnd, 0)
			currentPeriodEnd = &t
		}
	}

	// If the subscription isn't actually canceled, we do NOT set canceled_at (even if cancel_at_period_end=true).
	if stripeStatus != string(stripe.SubscriptionStatusCanceled) {
		canceledAt = nil
	}

	_, err = h.db.Exec(`
		UPDATE public.subscriptions
		SET status = $2,
			current_period_start = COALESCE($3, current_period_start),
			current_period_end = COALESCE($4, current_period_end),
			cancel_at_period_end = $5,
			canceled_at = $6,
			updated_at = NOW()
		WHERE user_id = $1
	`, userID, stripeStatus, currentPeriodStart, currentPeriodEnd, stripeCancelAtPeriodEnd, canceledAt)
	if err != nil {
		log.Printf("[Billing][CancelSubscription] database update error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":               "success",
		"stripeStatus":         stripeStatus,
		"cancelAtPeriodEnd":    stripeCancelAtPeriodEnd,
		"currentPeriodStart":   currentPeriodStart,
		"currentPeriodEnd":     currentPeriodEnd,
		"stripeSubscriptionId": stripeSubID,
	})
}

// GetUserInvoices returns billing history for a user
func (h *Handler) GetUserInvoices(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	userID := pathVar(r, "userId")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "userId is required")
		return
	}

	limit := parseLimit(r, 20, 1, 100)

	rows, err := h.db.Query(`
		SELECT id, stripe_invoice_id, amount_due, amount_paid, currency, status,
		       invoice_pdf, hosted_invoice_url, period_start, period_end, created_at
		FROM public.invoices
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)

	if err != nil {
		log.Printf("[Billing][Invoices] query error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	var invoices []Invoice
	for rows.Next() {
		var inv Invoice
		var pdf, url sql.NullString
		var periodStart, periodEnd sql.NullTime

		err := rows.Scan(&inv.ID, &inv.StripeInvoiceID, &inv.AmountDue, &inv.AmountPaid,
			&inv.Currency, &inv.Status, &pdf, &url, &periodStart, &periodEnd, &inv.CreatedAt)

		if err != nil {
			log.Printf("[Billing][Invoices] scan error userId=%s: %v", userID, err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// Inline nullStringPtr logic for invoice
		if pdf.Valid {
			inv.InvoicePDF = &pdf.String
		} else {
			inv.InvoicePDF = nil
		}
		if url.Valid {
			inv.HostedInvoiceURL = &url.String
		} else {
			inv.HostedInvoiceURL = nil
		}
		if periodStart.Valid {
			inv.PeriodStart = &periodStart.Time
		} else {
			inv.PeriodStart = nil
		}
		if periodEnd.Valid {
			inv.PeriodEnd = &periodEnd.Time
		} else {
			inv.PeriodEnd = nil
		}
		inv.UserID = userID

		invoices = append(invoices, inv)
	}

	if len(invoices) > 0 {
		writeJSON(w, http.StatusOK, invoices)
		return
	}

	// Fallback: if we don't have invoice rows yet (e.g. webhook not running in dev), fetch from Stripe.
	initStripe()
	if stripeClient == nil {
		writeJSON(w, http.StatusOK, invoices)
		return
	}

	var stripeCustomerID sql.NullString
	err = h.db.QueryRow(`
		SELECT stripe_customer_id
		FROM public.subscriptions
		WHERE user_id = $1
	`, userID).Scan(&stripeCustomerID)
	if err != nil {
		writeJSON(w, http.StatusOK, invoices)
		return
	}
	if !stripeCustomerID.Valid || strings.TrimSpace(stripeCustomerID.String) == "" {
		writeJSON(w, http.StatusOK, invoices)
		return
	}

	params := &stripe.InvoiceListParams{}
	params.Customer = stripe.String(stripeCustomerID.String)
	params.Limit = stripe.Int64(int64(limit))
	iter := stripeClient.Invoices.List(params)
	for iter.Next() {
		si := iter.Invoice()
		if si == nil {
			continue
		}
		inv := Invoice{
			ID:              si.ID,
			UserID:          userID,
			StripeInvoiceID: si.ID,
			AmountDue:       int(si.AmountDue),
			AmountPaid:      int(si.AmountPaid),
			Currency:        string(si.Currency),
			Status:          string(si.Status),
			CreatedAt:       time.Unix(si.Created, 0),
		}
		if si.InvoicePDF != "" {
			inv.InvoicePDF = &si.InvoicePDF
		}
		if si.HostedInvoiceURL != "" {
			inv.HostedInvoiceURL = &si.HostedInvoiceURL
		}
		if si.PeriodStart != 0 {
			t := time.Unix(si.PeriodStart, 0)
			inv.PeriodStart = &t
		}
		if si.PeriodEnd != 0 {
			t := time.Unix(si.PeriodEnd, 0)
			inv.PeriodEnd = &t
		}
		invoices = append(invoices, inv)
	}

	writeJSON(w, http.StatusOK, invoices)
}

// StripeWebhook handles Stripe webhook events
func (h *Handler) StripeWebhook(w http.ResponseWriter, r *http.Request) {
	log.Printf("[Billing][Webhook] received webhook: %s %s", r.Method, r.URL.Path)

	// Log full payload in debug mode
	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "debug" {
		body, err := io.ReadAll(r.Body)
		if err == nil {
			log.Printf("[Billing][Webhook] DEBUG - Full payload: %s", string(body))
			// Restore the body for further processing
			r.Body = io.NopCloser(bytes.NewBuffer(body))
		}
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	const MaxBodyBytes = int64(65536)
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)

	payload, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("[Billing][Webhook] read error: %v", err)
		writeError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}

	if logLevel == "debug" {
		log.Printf("[Billing][Webhook] DEBUG - Processed payload: %s", string(payload))
	}

	// Verify webhook signature
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	if strings.Contains(r.URL.Path, "/snapshot") {
		if s := os.Getenv("STRIPE_WEBHOOK_SECRET_SNAPSHOT"); s != "" {
			webhookSecret = s
		}
	} else if strings.Contains(r.URL.Path, "/thin") {
		if s := os.Getenv("STRIPE_WEBHOOK_SECRET_THIN"); s != "" {
			webhookSecret = s
		}
	}
	if webhookSecret == "" {
		log.Printf("[Billing][Webhook] STRIPE_WEBHOOK_SECRET not set, skipping signature verification")
	} else {
		sig := r.Header.Get("Stripe-Signature")
		if sig == "" {
			log.Printf("[Billing][Webhook] missing Stripe-Signature header")
			writeError(w, http.StatusBadRequest, "Missing signature")
			return
		}

		event, err := webhook.ConstructEventWithOptions(payload, sig, webhookSecret, webhook.ConstructEventOptions{
			IgnoreAPIVersionMismatch: true,
		})
		if err != nil {
			log.Printf("[Billing][Webhook] signature verification error: %v", err)
			writeError(w, http.StatusBadRequest, "Invalid signature")
			return
		}

		// Process the verified event
		h.processStripeEvent(event)
		writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
		return
	}

	// Fallback: process without verification (not recommended for production)
	var event stripe.Event
	err = json.Unmarshal(payload, &event)
	if err != nil {
		log.Printf("[Billing][Webhook] unmarshal error: %v", err)
		writeError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	h.processStripeEvent(event)
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (h *Handler) processStripeEvent(event stripe.Event) {
	// Save event for processing
	eventID := fmt.Sprintf("evt_%s", event.ID)

	_, err := h.db.Exec(`
		INSERT INTO public.billing_events (id, stripe_event_id, type, data, created_at, user_id)
		VALUES ($1, $2, $3, $4, NOW(), NULL)
		ON CONFLICT (stripe_event_id) DO NOTHING
	`, eventID, event.ID, event.Type, event.Data.Raw)

	if err != nil {
		log.Printf("[Billing][Webhook] event save error: %v", err)
	}

	// Process event based on type
	switch event.Type {
	// Product events
	case "product.created", "product.updated":
		h.handleProductEvent(event)
	case "product.deleted":
		h.handleProductDeletion(event)

	// Price events (new API)
	case "price.created", "price.updated":
		h.handlePriceEvent(event)
	case "price.deleted":
		h.handlePriceDeletion(event)

	// Plan events (legacy API)
	case "plan.created", "plan.updated":
		h.handlePlanEvent(event)
	case "plan.deleted":
		h.handlePlanDeletion(event)

	// Subscription events
	case "customer.subscription.created", "customer.subscription.updated":
		h.handleSubscriptionEvent(event)
	case "customer.subscription.deleted":
		h.handleSubscriptionCancellation(event)

	// Invoice events
	case "invoice.payment_succeeded":
		h.handlePaymentSuccess(event)
	case "invoice.payment_failed":
		h.handlePaymentFailure(event)
	case "invoice.created":
		h.handleInvoiceCreated(event)
	case "invoice.updated":
		h.handleInvoiceUpdated(event)
	case "invoice.finalized":
		h.handleInvoiceFinalized(event)
	case "invoice.paid":
		h.handleInvoicePaid(event)

	// Customer events
	case "customer.created":
		h.handleCustomerCreated(event)
	case "customer.updated":
		h.handleCustomerUpdated(event)

	default:
		log.Printf("[Billing][Webhook] unhandled event type: %s", event.Type)
	}
}

func (h *Handler) handleSubscriptionEvent(event stripe.Event) {
	var subscription stripe.Subscription
	err := json.Unmarshal(event.Data.Raw, &subscription)
	if err != nil {
		log.Printf("[Billing][SubscriptionEvent] unmarshal error: %v", err)
		return
	}

	stripeSubID := strings.TrimSpace(subscription.ID)
	stripeCustomerID := ""
	if subscription.Customer != nil {
		stripeCustomerID = strings.TrimSpace(subscription.Customer.ID)
	}

	var userID string
	err = h.db.QueryRow(`
		SELECT user_id
		FROM public.subscriptions
		WHERE stripe_subscription_id = $1
		LIMIT 1
	`, stripeSubID).Scan(&userID)
	if err == sql.ErrNoRows && stripeCustomerID != "" {
		err = h.db.QueryRow(`
			SELECT user_id
			FROM public.subscriptions
			WHERE stripe_customer_id = $1
			LIMIT 1
		`, stripeCustomerID).Scan(&userID)
	}
	if err != nil {
		log.Printf("[Billing][SubscriptionEvent] user lookup error stripeSubId=%s stripeCustomerId=%s: %v", stripeSubID, stripeCustomerID, err)
		return
	}

	planID := ""
	if subscription.Items != nil && len(subscription.Items.Data) > 0 {
		it := subscription.Items.Data[0]
		if it != nil && it.Price != nil {
			priceID := strings.TrimSpace(it.Price.ID)
			productID := ""
			if it.Price.Product != nil {
				productID = strings.TrimSpace(it.Price.Product.ID)
			}
			var pid string
			err = h.db.QueryRow(`
				SELECT id
				FROM public.billing_plans
				WHERE stripe_price_id = $1 OR stripe_product_id = $2
				LIMIT 1
			`, priceID, productID).Scan(&pid)
			if err == nil {
				planID = pid
			}
		}
	}
	if planID == "" {
		planID = "free"
	}

	periodStart := time.Unix(subscription.CurrentPeriodStart, 0)
	periodEnd := time.Unix(subscription.CurrentPeriodEnd, 0)
	var canceledAt *time.Time
	if subscription.CanceledAt != 0 {
		t := time.Unix(subscription.CanceledAt, 0)
		canceledAt = &t
	}
	if string(subscription.Status) != string(stripe.SubscriptionStatusCanceled) {
		canceledAt = nil
	}

	rowID := fmt.Sprintf("sub_%s", stripeSubID)
	_, err = h.db.Exec(`
		INSERT INTO public.subscriptions (
			id, user_id, plan_id, stripe_subscription_id, stripe_customer_id,
			status, current_period_start, current_period_end,
			cancel_at_period_end, canceled_at,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8,
			$9, $10,
			NOW(), NOW()
		)
		ON CONFLICT (user_id) DO UPDATE SET
			plan_id = EXCLUDED.plan_id,
			stripe_subscription_id = EXCLUDED.stripe_subscription_id,
			stripe_customer_id = EXCLUDED.stripe_customer_id,
			status = EXCLUDED.status,
			current_period_start = EXCLUDED.current_period_start,
			current_period_end = EXCLUDED.current_period_end,
			cancel_at_period_end = EXCLUDED.cancel_at_period_end,
			canceled_at = EXCLUDED.canceled_at,
			updated_at = NOW()
	`, rowID, userID, planID, stripeSubID, nullIfEmpty(stripeCustomerID),
		string(subscription.Status), periodStart, periodEnd,
		subscription.CancelAtPeriodEnd, canceledAt)
	if err != nil {
		log.Printf("[Billing][SubscriptionEvent] upsert error stripeSubId=%s: %v", stripeSubID, err)
	}
}

func (h *Handler) handleSubscriptionCancellation(event stripe.Event) {
	var subscription stripe.Subscription
	err := json.Unmarshal(event.Data.Raw, &subscription)
	if err != nil {
		log.Printf("[Billing][CancellationEvent] unmarshal error: %v", err)
		return
	}

	stripeSubID := strings.TrimSpace(subscription.ID)
	var canceledAt *time.Time
	if subscription.CanceledAt != 0 {
		t := time.Unix(subscription.CanceledAt, 0)
		canceledAt = &t
	}
	if canceledAt == nil {
		now := time.Now()
		canceledAt = &now
	}

	_, err = h.db.Exec(`
		UPDATE public.subscriptions
		SET status = 'canceled', cancel_at_period_end = false, canceled_at = $2, updated_at = NOW()
		WHERE stripe_subscription_id = $1
	`, stripeSubID, canceledAt)
	if err != nil {
		log.Printf("[Billing][CancellationEvent] update error: %v", err)
	}
}

func (h *Handler) handlePaymentSuccess(event stripe.Event) {
	var invoice stripe.Invoice
	err := json.Unmarshal(event.Data.Raw, &invoice)
	if err != nil {
		log.Printf("[Billing][PaymentSuccess] unmarshal error: %v", err)
		return
	}

	// Get user ID from customer
	var userID string
	err = h.db.QueryRow(`
		SELECT user_id FROM public.subscriptions
		WHERE stripe_customer_id = $1
	`, invoice.Customer.ID).Scan(&userID)

	if err != nil {
		log.Printf("[Billing][PaymentSuccess] user lookup error: %v", err)
		return
	}

	h.upsertInvoiceFromStripe(userID, &invoice)
}

func (h *Handler) handleInvoiceUpdated(event stripe.Event) {
	var invoice stripe.Invoice
	err := json.Unmarshal(event.Data.Raw, &invoice)
	if err != nil {
		log.Printf("[Billing][InvoiceUpdated] unmarshal error: %v", err)
		return
	}
	userID, err := h.userIDForStripeCustomer(invoice.Customer)
	if err != nil {
		log.Printf("[Billing][InvoiceUpdated] user lookup error: %v", err)
		return
	}
	h.upsertInvoiceFromStripe(userID, &invoice)
}

func (h *Handler) handleInvoiceFinalized(event stripe.Event) {
	var invoice stripe.Invoice
	err := json.Unmarshal(event.Data.Raw, &invoice)
	if err != nil {
		log.Printf("[Billing][InvoiceFinalized] unmarshal error: %v", err)
		return
	}
	userID, err := h.userIDForStripeCustomer(invoice.Customer)
	if err != nil {
		log.Printf("[Billing][InvoiceFinalized] user lookup error: %v", err)
		return
	}
	h.upsertInvoiceFromStripe(userID, &invoice)
}

func (h *Handler) handleInvoicePaid(event stripe.Event) {
	var invoice stripe.Invoice
	err := json.Unmarshal(event.Data.Raw, &invoice)
	if err != nil {
		log.Printf("[Billing][InvoicePaid] unmarshal error: %v", err)
		return
	}
	userID, err := h.userIDForStripeCustomer(invoice.Customer)
	if err != nil {
		log.Printf("[Billing][InvoicePaid] user lookup error: %v", err)
		return
	}
	h.upsertInvoiceFromStripe(userID, &invoice)
}

func (h *Handler) handlePaymentFailure(event stripe.Event) {
	var invoice stripe.Invoice
	err := json.Unmarshal(event.Data.Raw, &invoice)
	if err != nil {
		log.Printf("[Billing][PaymentFailure] unmarshal error: %v", err)
		return
	}

	// Log payment failure - could send notification to user
	log.Printf("[Billing][PaymentFailure] Payment failed for invoice %s, customer %s", invoice.ID, invoice.Customer.ID)
}

// DeleteBillingPlan deletes a billing plan
func (h *Handler) DeleteBillingPlan(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodDelete) {
		return
	}

	planID := pathVar(r, "planId")
	if planID == "" {
		writeError(w, http.StatusBadRequest, "planId is required")
		return
	}

	// Check if plan is being used by active subscriptions
	var count int
	err := h.db.QueryRow("SELECT COUNT(*) FROM public.subscriptions WHERE plan_id = $1 AND status = 'active'", planID).Scan(&count)
	if err != nil {
		log.Printf("[Billing][DeletePlan] count error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to check plan usage")
		return
	}

	if count > 0 {
		writeError(w, http.StatusConflict, "Cannot delete plan that has active subscriptions")
		return
	}

	result, err := h.db.Exec("DELETE FROM public.billing_plans WHERE id = $1", planID)
	if err != nil {
		log.Printf("[Billing][DeletePlan] error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to delete plan")
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		writeError(w, http.StatusNotFound, "Plan not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func inlineNullStringPtr(ns sql.NullString) *string {
	if ns.Valid {
		return &ns.String
	}
	return nil
}

func inlineNullTimePtr(nt sql.NullTime) *time.Time {
	if nt.Valid {
		return &nt.Time
	}
	return nil
}

func inlineNullTime(t int64) *time.Time {
	if t == 0 {
		return nil
	}
	tm := time.Unix(t, 0)
	return &tm
}

func nullIfEmpty(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func (h *Handler) userIDForStripeCustomer(cust *stripe.Customer) (string, error) {
	if cust == nil {
		return "", fmt.Errorf("missing customer")
	}
	custID := strings.TrimSpace(cust.ID)
	if custID == "" {
		return "", fmt.Errorf("missing customer id")
	}
	var userID string
	err := h.db.QueryRow(`
		SELECT user_id
		FROM public.subscriptions
		WHERE stripe_customer_id = $1
		LIMIT 1
	`, custID).Scan(&userID)
	if err != nil {
		return "", err
	}
	return userID, nil
}

func (h *Handler) upsertInvoiceFromStripe(userID string, invoice *stripe.Invoice) {
	userID = strings.TrimSpace(userID)
	if userID == "" || invoice == nil {
		return
	}

	subscriptionID := ""
	if invoice.Subscription != nil {
		subscriptionID = strings.TrimSpace(invoice.Subscription.ID)
	}
	var localSubID sql.NullString
	if subscriptionID != "" {
		_ = h.db.QueryRow(`
			SELECT id
			FROM public.subscriptions
			WHERE stripe_subscription_id = $1
			LIMIT 1
		`, subscriptionID).Scan(&localSubID)
	}

	invRowID := fmt.Sprintf("inv_%s", invoice.ID)
	_, err := h.db.Exec(`
		INSERT INTO public.invoices (
			id, user_id, subscription_id, stripe_invoice_id,
			amount_due, amount_paid, currency, status,
			invoice_pdf, hosted_invoice_url,
			period_start, period_end,
			created_at
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			$9, $10,
			$11, $12,
			NOW()
		)
		ON CONFLICT (stripe_invoice_id) DO UPDATE SET
			amount_due = EXCLUDED.amount_due,
			amount_paid = EXCLUDED.amount_paid,
			currency = EXCLUDED.currency,
			status = EXCLUDED.status,
			invoice_pdf = EXCLUDED.invoice_pdf,
			hosted_invoice_url = EXCLUDED.hosted_invoice_url,
			period_start = EXCLUDED.period_start,
			period_end = EXCLUDED.period_end
	`, invRowID, userID, inlineNullStringPtr(localSubID), invoice.ID,
		invoice.AmountDue, invoice.AmountPaid, invoice.Currency, invoice.Status,
		nullIfEmpty(invoice.InvoicePDF), nullIfEmpty(invoice.HostedInvoiceURL),
		inlineNullTime(invoice.PeriodStart), inlineNullTime(invoice.PeriodEnd))
	if err != nil {
		log.Printf("[Billing][InvoiceUpsert] upsert error userId=%s stripeInvoiceId=%s: %v", userID, invoice.ID, err)
	}
}

// Product event handlers
func (h *Handler) handleProductEvent(event stripe.Event) {
	var product stripe.Product
	err := json.Unmarshal(event.Data.Raw, &product)
	if err != nil {
		log.Printf("[Billing][ProductEvent] unmarshal error: %v", err)
		return
	}

	productID := fmt.Sprintf("prod_%s", product.ID)

	// Convert metadata to JSON for database storage
	metadataJSON, err := json.Marshal(product.Metadata)
	if err != nil {
		log.Printf("[Billing][ProductEvent] metadata marshal error: %v", err)
		metadataJSON = []byte("{}")
	}

	_, err = h.db.Exec(`
		INSERT INTO public.stripe_products (id, stripe_product_id, name, description, active, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		ON CONFLICT (stripe_product_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			active = EXCLUDED.active,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`, productID, product.ID, product.Name, product.Description, product.Active, metadataJSON)

	if err != nil {
		log.Printf("[Billing][ProductEvent] product save error: %v", err)
	}

	// If this is a product.updated event, update associated billing plans
	if event.Type == "product.updated" {
		h.updateAssociatedBillingPlans(product.ID, &product)
	}
}

// updateAssociatedBillingPlans updates all billing plans associated with a product
func (h *Handler) updateAssociatedBillingPlans(productID string, product *stripe.Product) {
	// Find all billing plans that use this product
	rows, err := h.db.Query(`
		SELECT id, stripe_price_id FROM public.billing_plans
		WHERE stripe_product_id = $1 AND is_active = true
	`, productID)
	if err != nil {
		log.Printf("[Billing][UpdatePlans] query error: %v", err)
		return
	}
	defer rows.Close()

	var updatedPlans []string
	for rows.Next() {
		var planID, stripePriceID string
		if err := rows.Scan(&planID, &stripePriceID); err != nil {
			continue
		}

		// Parse metadata for features and limits
		features := make(map[string]interface{})
		limits := make(map[string]interface{})

		// Parse features metadata
		if featuresStr, exists := product.Metadata["features"]; exists {
			var parsed interface{}
			if json.Unmarshal([]byte(featuresStr), &parsed) == nil {
				switch v := parsed.(type) {
				case map[string]interface{}:
					features = v
				case []interface{}:
					features = map[string]interface{}{"features": v}
				default:
					features["features"] = featuresStr
				}
			} else {
				features["features"] = featuresStr
			}
		}

		// Parse limits metadata
		if limitsStr, exists := product.Metadata["limits"]; exists {
			var parsed interface{}
			if json.Unmarshal([]byte(limitsStr), &parsed) == nil {
				switch v := parsed.(type) {
				case map[string]interface{}:
					limits = v
				case []interface{}:
					limits = map[string]interface{}{"limits": v}
				default:
					limits["limits"] = limitsStr
				}
			} else {
				limits["limits"] = limitsStr
			}
		}

		// Convert to JSON for database
		featuresJSON, _ := json.Marshal(features)
		limitsJSON, _ := json.Marshal(limits)

		// Update the billing plan
		_, err = h.db.Exec(`
			UPDATE public.billing_plans
			SET name = $1, description = $2, features = $3, limits = $4, updated_at = NOW()
			WHERE id = $5
		`, product.Name, product.Description, string(featuresJSON), string(limitsJSON), planID)

		if err != nil {
			log.Printf("[Billing][UpdatePlans] plan update error for %s: %v", planID, err)
		} else {
			updatedPlans = append(updatedPlans, planID)
			log.Printf("[Billing][UpdatePlans] Updated plan %s with product %s", planID, product.Name)
		}
	}

	if len(updatedPlans) > 0 {
		log.Printf("[Billing][UpdatePlans] Successfully updated %d plans for product %s", len(updatedPlans), product.Name)
	}
}

func (h *Handler) handleProductDeletion(event stripe.Event) {
	var product stripe.Product
	err := json.Unmarshal(event.Data.Raw, &product)
	if err != nil {
		log.Printf("[Billing][ProductDeletion] unmarshal error: %v", err)
		return
	}

	// Mark product as inactive instead of deleting
	_, err = h.db.Exec(`
		UPDATE public.stripe_products
		SET active = false, updated_at = NOW()
		WHERE stripe_product_id = $1
	`, product.ID)

	if err != nil {
		log.Printf("[Billing][ProductDeletion] product update error: %v", err)
	}
}

// Price event handlers
func (h *Handler) handlePriceEvent(event stripe.Event) {
	var price stripe.Price
	err := json.Unmarshal(event.Data.Raw, &price)
	if err != nil {
		log.Printf("[Billing][PriceEvent] unmarshal error: %v", err)
		return
	}

	// Always fetch the latest product data to get metadata
	if price.Product != nil && price.Product.ID != "" {
		product, err := stripeClient.Products.Get(price.Product.ID, nil)
		if err != nil {
			log.Printf("[Billing][PriceEvent] Failed to fetch product %s: %v", price.Product.ID, err)
			return
		}
		// Use the product with latest metadata
		price.Product = product
	}

	h.handlePriceEventInternal(&price)
}

// handlePriceEventInternal contains the core price/plan processing logic
func (h *Handler) handlePriceEventInternal(price *stripe.Price) {
	// If price is associated with a product, update or create billing plan
	if price.Product != nil && price.Product.ID != "" {
		planID := fmt.Sprintf("price_%s", price.ID)
		var features, limits map[string]interface{}

		// Convert metadata from map[string]string to map[string]interface{}
		var planName string
		if product, err := stripeClient.Products.Get(price.Product.ID, nil); err == nil {
			features = make(map[string]interface{})
			limits := make(map[string]interface{})

			// Parse features metadata
			if featuresStr, exists := product.Metadata["features"]; exists {
				var parsed interface{}
				if json.Unmarshal([]byte(featuresStr), &parsed) == nil {
					switch v := parsed.(type) {
					case map[string]interface{}:
						features = v
					case []interface{}:
						features = map[string]interface{}{"features": v}
					default:
						features["features"] = featuresStr
					}
				} else {
					features["features"] = featuresStr
				}
			}

			// Parse limits metadata
			if limitsStr, exists := product.Metadata["limits"]; exists {
				var parsed interface{}
				if json.Unmarshal([]byte(limitsStr), &parsed) == nil {
					switch v := parsed.(type) {
					case map[string]interface{}:
						limits = v
					case []interface{}:
						limits = map[string]interface{}{"limits": v}
					default:
						limits["limits"] = limitsStr
					}
				} else {
					limits["limits"] = limitsStr
				}
			}

			log.Printf("[Billing][PriceEvent] Successfully fetched product %s for price %s", product.Name, price.ID)
			// Use product name as fallback if price nickname is empty
			planName = price.Nickname
			if planName == "" {
				planName = product.Name
			}

			// UPSERT Product to ensure FK constraint is satisfied
			productID := fmt.Sprintf("prod_%s", product.ID)
			metadataJSON, _ := json.Marshal(product.Metadata)
			_, err = h.db.Exec(`
                INSERT INTO public.stripe_products (id, stripe_product_id, name, description, active, metadata, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                ON CONFLICT (stripe_product_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    active = EXCLUDED.active,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
            `, productID, product.ID, product.Name, product.Description, product.Active, metadataJSON)
			if err != nil {
				log.Printf("[Billing][PriceEvent] product upsert error: %v", err)
			}
		} else {
			log.Printf("[Billing][PriceEvent] Failed to fetch product %s for price %s: %v. Aborting sync.", price.Product.ID, price.ID, err)
			return
		}

		// Convert price from cents (Stripe unit_amount is already in cents)
		priceCents := int(price.UnitAmount)

		// Convert maps to JSON strings for database
		featuresJSON, _ := json.Marshal(features)
		limitsJSON, _ := json.Marshal(limits)

		// Check if there's an existing legacy plan with matching name (free, pro, enterprise)
		var existingLegacyPlanID sql.NullString
		err := h.db.QueryRow(`
			SELECT id FROM public.billing_plans
			WHERE name = $1 AND id IN ('free', 'pro', 'enterprise')
			LIMIT 1
		`, planName).Scan(&existingLegacyPlanID)

		if err == nil && existingLegacyPlanID.Valid {
			// Update the existing legacy plan instead of creating a duplicate
			planID = existingLegacyPlanID.String
			log.Printf("[Billing][PriceEvent] Linking Stripe price %s to existing legacy plan %s", price.ID, planID)
		}

		_, err = h.db.Exec(`
			INSERT INTO public.billing_plans (id, name, description, price_cents, currency, interval, stripe_price_id, stripe_product_id, features, limits, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				price_cents = EXCLUDED.price_cents,
				currency = EXCLUDED.currency,
				interval = EXCLUDED.interval,
				stripe_price_id = EXCLUDED.stripe_price_id,
				stripe_product_id = EXCLUDED.stripe_product_id,
				features = EXCLUDED.features,
				limits = EXCLUDED.limits,
				updated_at = NOW()
		`, planID, planName, price.Metadata["description"], priceCents,
			string(price.Currency), string(price.Recurring.Interval), price.ID, price.Product.ID, string(featuresJSON), string(limitsJSON))

		if err != nil {
			log.Printf("[Billing][PriceEvent] plan save error: %v", err)
		} else {
			log.Printf("[Billing][PriceEvent] Successfully saved/updated plan %s (%s) - $%d.%02d/%s", planID, planName, priceCents/100, priceCents%100, price.Recurring.Interval)
		}
	} else {
		log.Printf("[Billing][PriceEvent] Price %s has no product association, skipping", price.ID)
	}
}

// handlePlanEvent handles legacy Stripe plan events (for backwards compatibility)
func (h *Handler) handlePlanEvent(event stripe.Event) {
	var plan stripe.Plan
	err := json.Unmarshal(event.Data.Raw, &plan)
	if err != nil {
		log.Printf("[Billing][PlanEvent] unmarshal error: %v", err)
		return
	}

	log.Printf("[Billing][PlanEvent] Processing plan %s (%s) - $%d.%02d/%s", plan.ID, plan.Nickname, plan.Amount/100, plan.Amount%100, plan.Interval)

	// Convert plan to price-like structure for processing
	price := &stripe.Price{
		ID:       plan.ID,
		Nickname: plan.Nickname,
		Product: &stripe.Product{
			ID: plan.Product.ID,
		},
		UnitAmount: plan.Amount,
		Currency:   plan.Currency,
		Recurring: &stripe.PriceRecurring{
			Interval: stripe.PriceRecurringInterval(plan.Interval),
		},
		Metadata: plan.Metadata,
	}

	// Process using the existing price event logic
	h.handlePriceEventInternal(price)
}

// handlePlanDeletion handles legacy Stripe plan deletion events
func (h *Handler) handlePlanDeletion(event stripe.Event) {
	var plan stripe.Plan
	err := json.Unmarshal(event.Data.Raw, &plan)
	if err != nil {
		log.Printf("[Billing][PlanDeletion] unmarshal error: %v", err)
		return
	}

	// Deactivate the billing plan
	_, err = h.db.Exec(`
		UPDATE public.billing_plans
		SET is_active = false, updated_at = NOW()
		WHERE stripe_price_id = $1
	`, plan.ID)

	if err != nil {
		log.Printf("[Billing][PlanDeletion] plan deactivation error: %v", err)
	}
}

func (h *Handler) handlePriceDeletion(event stripe.Event) {
	var price stripe.Price
	err := json.Unmarshal(event.Data.Raw, &price)
	if err != nil {
		log.Printf("[Billing][PriceDeletion] unmarshal error: %v", err)
		return
	}

	// Protect legacy plans from deletion - only deactivate non-legacy plans
	// Legacy plans (free, pro, enterprise) should only be deleted manually via admin UI
	_, err = h.db.Exec(`
		UPDATE public.billing_plans
		SET is_active = false, updated_at = NOW()
		WHERE stripe_price_id = $1 AND id NOT IN ('free', 'pro', 'enterprise')
	`, price.ID)

	if err != nil {
		log.Printf("[Billing][PriceDeletion] plan deactivation error: %v", err)
	} else {
		log.Printf("[Billing][PriceDeletion] Deactivated price %s (skipped legacy plans)", price.ID)
	}
}

// UpdateBillingPlan updates a billing plan in both database and Stripe
func (h *Handler) UpdateBillingPlan(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPut) {
		return
	}

	planID := pathVar(r, "id")
	if planID == "" {
		writeError(w, http.StatusBadRequest, "plan ID is required")
		return
	}

	// Get current plan to check if it has Stripe integration
	var currentPlan BillingPlan
	var desc, stripePriceID, stripeProductID sql.NullString
	var features, limits sql.NullString
	err := h.db.QueryRow(`
		SELECT id, name, description, price_cents, currency, interval, stripe_price_id, stripe_product_id, features, limits, is_active, is_custom_price
		FROM public.billing_plans
		WHERE id = $1
	`, planID).Scan(&currentPlan.ID, &currentPlan.Name, &desc, &currentPlan.PriceCents, &currentPlan.Currency, &currentPlan.Interval, &stripePriceID, &stripeProductID, &features, &limits, &currentPlan.IsActive, &currentPlan.IsCustomPrice)

	if err != nil {
		log.Printf("[Billing][UpdatePlan] plan not found: %v", err)
		writeError(w, http.StatusNotFound, "plan not found")
		return
	}

	// Parse updated plan data
	var updatedPlan BillingPlan
	if err := decodeJSON(r, &updatedPlan); err != nil {
		log.Printf("[Billing][UpdatePlan] decode error: %v", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Validate required fields
	if updatedPlan.Name == "" {
		writeError(w, http.StatusBadRequest, "plan name is required")
		return
	}
	if updatedPlan.PriceCents < 0 {
		writeError(w, http.StatusBadRequest, "price must be non-negative")
		return
	}

	// Convert features and limits to JSON for database
	featuresJSON := "{}"
	if updatedPlan.Features != nil {
		if jsonBytes, err := json.Marshal(updatedPlan.Features); err == nil {
			featuresJSON = string(jsonBytes)
		}
	}

	limitsJSON := "{}"
	if updatedPlan.Limits != nil {
		if jsonBytes, err := json.Marshal(updatedPlan.Limits); err == nil {
			limitsJSON = string(jsonBytes)
		}
	}

	// 1. Update database
	description := updatedPlan.Description
	if description == nil {
		if desc.Valid {
			description = &desc.String
		}
	}

	_, err = h.db.Exec(`
		UPDATE public.billing_plans
		SET name = $1, description = $2, price_cents = $3, currency = $4, interval = $5,
		    features = $6, limits = $7, is_custom_price = $8, updated_at = NOW()
		WHERE id = $9
	`, updatedPlan.Name, description, updatedPlan.PriceCents, updatedPlan.Currency, updatedPlan.Interval,
		featuresJSON, limitsJSON, updatedPlan.IsCustomPrice, planID)

	if err != nil {
		log.Printf("[Billing][UpdatePlan] database update error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to update plan")
		return
	}

	// 2. Update Stripe if it has Stripe IDs
	var stripeError error
	if (stripePriceID.Valid && stripePriceID.String != "") || (stripeProductID.Valid && stripeProductID.String != "") {
		initStripe()
		if stripeClient != nil {
			// Update product metadata (where we store features/limits).
			// Stripe prices can't store arbitrary JSON; product metadata is the intended place.
			if stripeProductID.Valid && stripeProductID.String != "" {
				productParams := &stripe.ProductParams{}
				productParams.Metadata = map[string]string{}
				if updatedPlan.Limits != nil {
					if jsonBytes, err := json.Marshal(updatedPlan.Limits); err == nil {
						productParams.Metadata["limits"] = string(jsonBytes)
					}
				}
				// Keep Stripe product name/description aligned for admin readability.
				productParams.Name = stripe.String(updatedPlan.Name)
				if description != nil && *description != "" {
					productParams.Description = stripe.String(*description)
				}

				_, err := stripeClient.Products.Update(stripeProductID.String, productParams)
				if err != nil {
					stripeError = err
					log.Printf("[Billing][UpdatePlan] failed to update Stripe product %s: %v", stripeProductID.String, err)
				} else {
					log.Printf("[Billing][UpdatePlan] successfully updated Stripe product %s", stripeProductID.String)
				}
			}

			// Update price nickname in Stripe (nice-to-have for admin clarity).
			// Note: Stripe doesn't allow updating unit_amount or currency on existing prices.
			if stripePriceID.Valid && stripePriceID.String != "" {
				params := &stripe.PriceParams{
					Nickname: stripe.String(updatedPlan.Name),
				}
				_, err := stripeClient.Prices.Update(stripePriceID.String, params)
				if err != nil {
					stripeError = err
					log.Printf("[Billing][UpdatePlan] failed to update Stripe price %s: %v", stripePriceID.String, err)
				} else {
					log.Printf("[Billing][UpdatePlan] successfully updated Stripe price %s", stripePriceID.String)
				}
			}
		} else {
			stripeError = fmt.Errorf("Stripe client not initialized")
			log.Printf("[Billing][UpdatePlan] Stripe client not available")
		}
	}

	// 3. Return response
	response := map[string]interface{}{
		"success": true,
		"message": "Plan updated successfully",
		"plan": map[string]interface{}{
			"id":            planID,
			"name":          updatedPlan.Name,
			"priceCents":    updatedPlan.PriceCents,
			"currency":      updatedPlan.Currency,
			"interval":      updatedPlan.Interval,
			"features":      updatedPlan.Features,
			"limits":        updatedPlan.Limits,
			"isCustomPrice": updatedPlan.IsCustomPrice,
			"stripeSynced":  stripeError == nil,
		},
	}

	if stripeError != nil {
		response["stripeError"] = stripeError.Error()
		response["warning"] = "Plan updated in database but failed to sync with Stripe"
	}

	log.Printf("[Billing][UpdatePlan] Successfully updated plan %s (Stripe sync: %v)", planID, stripeError == nil)
	writeJSON(w, http.StatusOK, response)
}

// MigrateBillingPlanPrice creates a new product/price and schedules migration of existing subscriptions
func (h *Handler) MigrateBillingPlanPrice(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	planID := pathVar(r, "id")
	if planID == "" {
		writeError(w, http.StatusBadRequest, "plan ID is required")
		return
	}

	// Parse request body
	var req struct {
		NewPriceCents     int    `json:"newPriceCents"`
		GracePeriodMonths int    `json:"gracePeriodMonths"`
		Reason            string `json:"reason,omitempty"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.NewPriceCents < 0 {
		writeError(w, http.StatusBadRequest, "price must be non-negative")
		return
	}
	if req.GracePeriodMonths < 0 {
		writeError(w, http.StatusBadRequest, "grace period must be non-negative")
		return
	}

	// Get current plan
	var currentPlan BillingPlan
	var desc, stripePriceID, productVersionGroup, migratedFromPlanID sql.NullString
	var features, limits sql.NullString
	err := h.db.QueryRow(`
		SELECT id, name, description, price_cents, currency, interval, stripe_price_id, features, limits,
		       product_version_group, migrated_from_plan_id
		FROM public.billing_plans
		WHERE id = $1
	`, planID).Scan(&currentPlan.ID, &currentPlan.Name, &desc, &currentPlan.PriceCents, &currentPlan.Currency,
		&currentPlan.Interval, &stripePriceID, &features, &limits, &productVersionGroup, &migratedFromPlanID)

	if err != nil {
		log.Printf("[Billing][MigratePlan] plan not found: %v", err)
		writeError(w, http.StatusNotFound, "plan not found")
		return
	}

	// Parse features and limits
	currentPlan.Features = make(map[string]interface{})
	if features.Valid {
		json.Unmarshal([]byte(features.String), &currentPlan.Features)
	}
	currentPlan.Limits = make(map[string]interface{})
	if limits.Valid {
		json.Unmarshal([]byte(limits.String), &currentPlan.Limits)
	}

	// Generate version group ID if not exists
	versionGroup := productVersionGroup.String
	if versionGroup == "" {
		versionGroup = fmt.Sprintf("group_%s_%d", planID, time.Now().Unix())
	}

	// Create new product in Stripe
	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	// Create new product with version suffix
	newProductName := fmt.Sprintf("%s (v%d)", currentPlan.Name, time.Now().Unix())
	productParams := &stripe.ProductParams{
		Name: stripe.String(newProductName),
		Type: stripe.String(string(stripe.ProductTypeService)),
		Metadata: map[string]string{
			"product_version_group": versionGroup,
			"migrated_from_plan":    planID,
			"migration_reason":      req.Reason,
			"migration_date":        time.Now().Format(time.RFC3339),
		},
	}

	// Only set description if it exists and is non-empty
	if currentPlan.Description != nil && *currentPlan.Description != "" {
		productParams.Description = stripe.String(*currentPlan.Description)
	}

	// Copy features and limits to metadata
	if currentPlan.Features != nil {
		if featuresJSON, err := json.Marshal(currentPlan.Features); err == nil {
			productParams.Metadata["features"] = string(featuresJSON)
		}
	}
	if currentPlan.Limits != nil {
		if limitsJSON, err := json.Marshal(currentPlan.Limits); err == nil {
			productParams.Metadata["limits"] = string(limitsJSON)
		}
	}

	newProduct, err := stripeClient.Products.New(productParams)
	if err != nil {
		log.Printf("[Billing][MigratePlan] failed to create new product: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create new product in Stripe")
		return
	}

	// Insert the new product into stripe_products table to satisfy foreign key constraint
	productID := fmt.Sprintf("prod_%s", newProduct.ID)

	// Convert metadata to JSON for database storage
	var metadataJSON []byte
	if newProduct.Metadata != nil {
		metadataJSON, err = json.Marshal(newProduct.Metadata)
		if err != nil {
			log.Printf("[Billing][MigratePlan] failed to marshal metadata: %v", err)
			writeError(w, http.StatusInternalServerError, "failed to process product metadata")
			return
		}
	} else {
		metadataJSON = []byte("{}")
	}

	_, err = h.db.Exec(`
		INSERT INTO public.stripe_products (id, stripe_product_id, name, description, active, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		ON CONFLICT (stripe_product_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			active = EXCLUDED.active,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`, productID, newProduct.ID, newProduct.Name, newProduct.Description, newProduct.Active, string(metadataJSON))

	if err != nil {
		log.Printf("[Billing][MigratePlan] failed to save product to database: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to save product to database")
		return
	}

	// Create new price
	priceParams := &stripe.PriceParams{
		Product:    stripe.String(newProduct.ID),
		UnitAmount: stripe.Int64(int64(req.NewPriceCents)),
		Currency:   stripe.String(currentPlan.Currency),
		Nickname:   stripe.String(currentPlan.Name),
		Recurring: &stripe.PriceRecurringParams{
			Interval: stripe.String(currentPlan.Interval),
		},
	}

	newPrice, err := stripeClient.Prices.New(priceParams)
	if err != nil {
		log.Printf("[Billing][MigratePlan] failed to create new price: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create new price in Stripe")
		return
	}

	// Create new plan in database
	newPlanID := fmt.Sprintf("price_%s", newPrice.ID)
	migrationScheduledAt := time.Now().AddDate(0, req.GracePeriodMonths, 0)

	_, err = h.db.Exec(`
		INSERT INTO public.billing_plans
		(id, name, description, price_cents, currency, interval, stripe_price_id, stripe_product_id,
		 features, limits, grace_period_months, product_version_group, migrated_from_plan_id,
		 migration_scheduled_at, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, NOW(), NOW())
	`, newPlanID, currentPlan.Name, currentPlan.Description, req.NewPriceCents, currentPlan.Currency,
		currentPlan.Interval, newPrice.ID, newProduct.ID,
		string(must(json.Marshal(currentPlan.Features))), string(must(json.Marshal(currentPlan.Limits))),
		req.GracePeriodMonths, versionGroup, planID, migrationScheduledAt)

	if err != nil {
		log.Printf("[Billing][MigratePlan] failed to create new plan: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create new plan")
		return
	}

	// Update old plan with version group and migration info
	_, err = h.db.Exec(`
		UPDATE public.billing_plans
		SET product_version_group = $1, updated_at = NOW()
		WHERE id = $2
	`, versionGroup, planID)

	if err != nil {
		log.Printf("[Billing][MigratePlan] failed to update old plan: %v", err)
	}

	log.Printf("[Billing][MigratePlan] Created new plan %s (price: %d cents) with %d month grace period",
		newPlanID, req.NewPriceCents, req.GracePeriodMonths)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"success":   true,
		"message":   "New plan created with grace period",
		"oldPlanId": planID,
		"newPlanId": newPlanID,
		"newPrice": map[string]interface{}{
			"id":       newPrice.ID,
			"amount":   req.NewPriceCents,
			"currency": currentPlan.Currency,
		},
		"gracePeriodMonths":    req.GracePeriodMonths,
		"migrationScheduledAt": migrationScheduledAt,
		"productVersionGroup":  versionGroup,
	})
}

// Helper function to handle json.Marshal errors
func must(data []byte, err error) []byte {
	if err != nil {
		return []byte("{}")
	}
	return data
}

// MigrateSubscriptionsAfterGracePeriod migrates subscriptions from old plans to new plans after grace period
func (h *Handler) MigrateSubscriptionsAfterGracePeriod(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	// Find all plans that have scheduled migrations
	rows, err := h.db.Query(`
		SELECT id, stripe_price_id, migrated_from_plan_id, migration_scheduled_at
		FROM public.billing_plans
		WHERE migrated_from_plan_id IS NOT NULL
		  AND migration_scheduled_at IS NOT NULL
		  AND migration_scheduled_at <= NOW()
		ORDER BY migration_scheduled_at ASC
	`)
	if err != nil {
		log.Printf("[Billing][MigrateSubscriptions] query error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to query plans")
		return
	}
	defer rows.Close()

	type PlanMigration struct {
		NewPlanID        string
		NewStripePriceID string
		OldPlanID        string
		ScheduledAt      time.Time
	}

	var migrations []PlanMigration
	for rows.Next() {
		var migration PlanMigration
		var stripePriceID, migratedFromPlanID sql.NullString
		var scheduledAt sql.NullTime
		if err := rows.Scan(&migration.NewPlanID, &stripePriceID, &migratedFromPlanID, &scheduledAt); err != nil {
			continue
		}
		if stripePriceID.Valid {
			migration.NewStripePriceID = stripePriceID.String
		}
		if migratedFromPlanID.Valid {
			migration.OldPlanID = migratedFromPlanID.String
		}
		if scheduledAt.Valid {
			migration.ScheduledAt = scheduledAt.Time
		}
		migrations = append(migrations, migration)
	}

	var migratedCount int
	var errors []string

	for _, migration := range migrations {
		// Find all subscriptions using the old plan
		subRows, err := h.db.Query(`
			SELECT id, stripe_subscription_id
			FROM public.subscriptions
			WHERE plan_id = $1 AND status = 'active'
		`, migration.OldPlanID)
		if err != nil {
			log.Printf("[Billing][MigrateSubscriptions] failed to query subscriptions: %v", err)
			errors = append(errors, fmt.Sprintf("Failed to query subscriptions for plan %s", migration.OldPlanID))
			continue
		}

		for subRows.Next() {
			var subID string
			var stripeSubIDNull sql.NullString
			if err := subRows.Scan(&subID, &stripeSubIDNull); err != nil {
				continue
			}
			if !stripeSubIDNull.Valid {
				continue
			}
			stripeSubID := stripeSubIDNull.String

			// Get subscription to find the item ID
			stripeSub, err := stripeClient.Subscriptions.Get(stripeSubID, nil)
			if err != nil {
				log.Printf("[Billing][MigrateSubscriptions] failed to get Stripe subscription %s: %v", stripeSubID, err)
				errors = append(errors, fmt.Sprintf("Failed to get Stripe subscription %s", stripeSubID))
				continue
			}

			if len(stripeSub.Items.Data) == 0 {
				log.Printf("[Billing][MigrateSubscriptions] no items found in subscription %s", stripeSubID)
				continue
			}

			// Update the subscription item with new price
			itemParams := &stripe.SubscriptionItemParams{
				Price: stripe.String(migration.NewStripePriceID),
			}

			_, err = stripeClient.SubscriptionItems.Update(stripeSub.Items.Data[0].ID, itemParams)
			if err != nil {
				log.Printf("[Billing][MigrateSubscriptions] failed to update subscription item: %v", err)
				errors = append(errors, fmt.Sprintf("Failed to update subscription %s", stripeSubID))
				continue
			}

			// Update subscription in database
			_, err = h.db.Exec(`
				UPDATE public.subscriptions
				SET plan_id = $1, updated_at = NOW()
				WHERE id = $2
			`, migration.NewPlanID, subID)

			if err != nil {
				log.Printf("[Billing][MigrateSubscriptions] failed to update subscription in database: %v", err)
				errors = append(errors, fmt.Sprintf("Failed to update subscription %s in database", subID))
				continue
			}

			migratedCount++
			log.Printf("[Billing][MigrateSubscriptions] Migrated subscription %s from %s to %s", subID, migration.OldPlanID, migration.NewPlanID)
		}
		subRows.Close()

		// Mark migration as complete by clearing migration_scheduled_at
		_, err = h.db.Exec(`
			UPDATE public.billing_plans
			SET migration_scheduled_at = NULL, updated_at = NOW()
			WHERE id = $1
		`, migration.NewPlanID)

		if err != nil {
			log.Printf("[Billing][MigrateSubscriptions] failed to mark migration complete: %v", err)
		}
	}

	log.Printf("[Billing][MigrateSubscriptions] Migrated %d subscriptions", migratedCount)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":       true,
		"migratedCount": migratedCount,
		"errors":        errors,
		"message":       fmt.Sprintf("Successfully migrated %d subscriptions", migratedCount),
	})
}

// GetProductVersions returns all versions of a product (by product_version_group)
func (h *Handler) GetProductVersions(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	versionGroup := pathVar(r, "versionGroup")
	if versionGroup == "" {
		writeError(w, http.StatusBadRequest, "version group is required")
		return
	}

	rows, err := h.db.Query(`
		SELECT id, name, description, price_cents, currency, interval, stripe_price_id,
		       features, limits, grace_period_months, migrated_from_plan_id, migration_scheduled_at,
		       is_active, created_at, updated_at
		FROM public.billing_plans
		WHERE product_version_group = $1
		ORDER BY created_at ASC
	`, versionGroup)
	if err != nil {
		log.Printf("[Billing][ProductVersions] query error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to query product versions")
		return
	}
	defer rows.Close()

	var versions []map[string]interface{}
	for rows.Next() {
		var id, name, currency, interval string
		var desc, stripePriceID, migratedFromPlanID sql.NullString
		var features, limits sql.NullString
		var priceCents, gracePeriodMonths int
		var isActive bool
		var createdAt, updatedAt time.Time
		var migrationScheduledAt sql.NullTime

		if err := rows.Scan(&id, &name, &desc, &priceCents, &currency, &interval, &stripePriceID,
			&features, &limits, &gracePeriodMonths, &migratedFromPlanID, &migrationScheduledAt,
			&isActive, &createdAt, &updatedAt); err != nil {
			continue
		}

		version := map[string]interface{}{
			"id":                id,
			"name":              name,
			"priceCents":        priceCents,
			"currency":          currency,
			"interval":          interval,
			"gracePeriodMonths": gracePeriodMonths,
			"isActive":          isActive,
			"createdAt":         createdAt,
			"updatedAt":         updatedAt,
		}

		if desc.Valid {
			version["description"] = desc.String
		}
		if stripePriceID.Valid {
			version["stripePriceId"] = stripePriceID.String
		}
		if migratedFromPlanID.Valid {
			version["migratedFromPlanId"] = migratedFromPlanID.String
		}
		if migrationScheduledAt.Valid {
			version["migrationScheduledAt"] = migrationScheduledAt.Time
		}
		if features.Valid {
			var featuresMap map[string]interface{}
			if err := json.Unmarshal([]byte(features.String), &featuresMap); err == nil {
				version["features"] = featuresMap
			}
		}
		if limits.Valid {
			var limitsMap map[string]interface{}
			if err := json.Unmarshal([]byte(limits.String), &limitsMap); err == nil {
				version["limits"] = limitsMap
			}
		}

		versions = append(versions, version)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":       true,
		"versionGroup":  versionGroup,
		"versions":      versions,
		"totalVersions": len(versions),
	})
}

// GetMigrationStatus returns migration status for a plan
func (h *Handler) GetMigrationStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	planID := pathVar(r, "id")
	if planID == "" {
		writeError(w, http.StatusBadRequest, "plan ID is required")
		return
	}

	// Get plan info
	var plan BillingPlan
	var productVersionGroup, migratedFromPlanID sql.NullString
	var migrationScheduledAt sql.NullTime
	err := h.db.QueryRow(`
		SELECT id, name, price_cents, grace_period_months, product_version_group,
		       migrated_from_plan_id, migration_scheduled_at
		FROM public.billing_plans
		WHERE id = $1
	`, planID).Scan(&plan.ID, &plan.Name, &plan.PriceCents, &plan.GracePeriodMonths,
		&productVersionGroup, &migratedFromPlanID, &migrationScheduledAt)

	if err != nil {
		log.Printf("[Billing][MigrationStatus] plan not found: %v", err)
		writeError(w, http.StatusNotFound, "plan not found")
		return
	}

	// Count subscriptions on this plan
	var subscriptionCount int
	h.db.QueryRow(`
		SELECT COUNT(*) FROM public.subscriptions
		WHERE plan_id = $1 AND status = 'active'
	`, planID).Scan(&subscriptionCount)

	// Count subscriptions that need migration (on old plan)
	var pendingMigrationCount int
	if migratedFromPlanID.Valid {
		h.db.QueryRow(`
			SELECT COUNT(*) FROM public.subscriptions
			WHERE plan_id = $1 AND status = 'active'
		`, migratedFromPlanID.String).Scan(&pendingMigrationCount)
	}

	status := "active"
	if migrationScheduledAt.Valid {
		if time.Now().After(migrationScheduledAt.Time) {
			status = "migration_overdue"
		} else {
			status = "migration_scheduled"
		}
	}

	response := map[string]interface{}{
		"success":               true,
		"planId":                plan.ID,
		"planName":              plan.Name,
		"priceCents":            plan.PriceCents,
		"gracePeriodMonths":     plan.GracePeriodMonths,
		"status":                status,
		"subscriptionCount":     subscriptionCount,
		"pendingMigrationCount": pendingMigrationCount,
	}

	if productVersionGroup.Valid {
		response["productVersionGroup"] = productVersionGroup.String
	}
	if migratedFromPlanID.Valid {
		response["migratedFromPlanId"] = migratedFromPlanID.String
	}
	if migrationScheduledAt.Valid {
		response["migrationScheduledAt"] = migrationScheduledAt.Time
		response["daysUntilMigration"] = int(time.Until(migrationScheduledAt.Time).Hours() / 24)
	}

	writeJSON(w, http.StatusOK, response)
}

// StartProductArchivalWorker starts a background goroutine that monitors and archives migrated products with no subscribers
func (h *Handler) StartProductArchivalWorker() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		log.Printf("[Billing][ArchivalWorker] Started product archival worker")

		// Run immediately on startup
		h.archiveOldMigratedProducts()

		for range ticker.C {
			h.archiveOldMigratedProducts()
		}
	}()
}

// archiveOldMigratedProducts finds migrated products with no active subscribers and archives them
func (h *Handler) archiveOldMigratedProducts() int {
	initStripe()
	if stripeClient == nil {
		log.Printf("[Billing][ArchivalWorker] Stripe not configured, skipping archival")
		return 0
	}

	// Find all migrated products (those with migrated_from_plan_id set) that are not already archived
	rows, err := h.db.Query(`
		SELECT id, stripe_product_id, name, product_version_group
		FROM public.billing_plans
		WHERE migrated_from_plan_id IS NOT NULL
		  AND is_archived = false
		  AND stripe_product_id IS NOT NULL
		ORDER BY migration_scheduled_at ASC
	`)
	if err != nil {
		log.Printf("[Billing][ArchivalWorker] failed to query migrated products: %v", err)
		return 0
	}
	defer rows.Close()

	type MigratedProduct struct {
		ID                  string
		StripeProductID     string
		Name                string
		ProductVersionGroup string
	}

	var products []MigratedProduct
	for rows.Next() {
		var product MigratedProduct
		var stripeProductID, versionGroup sql.NullString
		if err := rows.Scan(&product.ID, &stripeProductID, &product.Name, &versionGroup); err != nil {
			continue
		}
		if stripeProductID.Valid {
			product.StripeProductID = stripeProductID.String
		}
		if versionGroup.Valid {
			product.ProductVersionGroup = versionGroup.String
		}
		products = append(products, product)
	}

	var archivedCount int
	for _, product := range products {
		// Check if this product has any active subscriptions
		var activeSubCount int
		err := h.db.QueryRow(`
			SELECT COUNT(*) FROM public.subscriptions
			WHERE plan_id = $1 AND status = 'active'
		`, product.ID).Scan(&activeSubCount)

		if err != nil {
			log.Printf("[Billing][ArchivalWorker] failed to count subscriptions for plan %s: %v", product.ID, err)
			continue
		}

		// If there are active subscriptions, skip this product
		if activeSubCount > 0 {
			log.Printf("[Billing][ArchivalWorker] Plan %s has %d active subscriptions, skipping archival", product.ID, activeSubCount)
			continue
		}

		// Archive the product in Stripe
		stripeProductParams := &stripe.ProductParams{
			Active: stripe.Bool(false),
		}

		_, err = stripeClient.Products.Update(product.StripeProductID, stripeProductParams)
		if err != nil {
			log.Printf("[Billing][ArchivalWorker] failed to archive Stripe product %s: %v", product.StripeProductID, err)
			continue
		}

		// Mark as archived in database
		_, err = h.db.Exec(`
			UPDATE public.billing_plans
			SET is_archived = true, archived_at = NOW(), is_active = false, updated_at = NOW()
			WHERE id = $1
		`, product.ID)

		if err != nil {
			log.Printf("[Billing][ArchivalWorker] failed to mark plan %s as archived: %v", product.ID, err)
			continue
		}

		archivedCount++
		log.Printf("[Billing][ArchivalWorker] Archived product %s (%s) - no active subscriptions", product.ID, product.Name)
	}

	if archivedCount > 0 {
		log.Printf("[Billing][ArchivalWorker] Successfully archived %d products", archivedCount)
	}

	return archivedCount
}

// ArchiveOldProducts manually triggers the product archival process
func (h *Handler) ArchiveOldProducts(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	log.Printf("[Billing][ArchiveOldProducts] Manual archival process triggered")

	// Run the archival process
	archivedCount := h.archiveOldMigratedProducts()

	log.Printf("[Billing][ArchiveOldProducts] Manual archival completed, archived %d products", archivedCount)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":       true,
		"message":       fmt.Sprintf("Successfully archived %d products", archivedCount),
		"archivedCount": archivedCount,
	})
}

// ArchiveProduct manually archives a specific product (admin endpoint)
func (h *Handler) ArchiveProduct(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	planID := pathVar(r, "id")
	if planID == "" {
		writeError(w, http.StatusBadRequest, "plan ID is required")
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	// Get plan info
	var stripeProductID sql.NullString
	err := h.db.QueryRow(`
		SELECT stripe_product_id FROM public.billing_plans WHERE id = $1
	`, planID).Scan(&stripeProductID)

	if err != nil {
		log.Printf("[Billing][ArchiveProduct] plan not found: %v", err)
		writeError(w, http.StatusNotFound, "plan not found")
		return
	}

	if !stripeProductID.Valid {
		writeError(w, http.StatusBadRequest, "plan has no Stripe product ID")
		return
	}

	// Archive in Stripe
	stripeProductParams := &stripe.ProductParams{
		Active: stripe.Bool(false),
	}

	_, err = stripeClient.Products.Update(stripeProductID.String, stripeProductParams)
	if err != nil {
		log.Printf("[Billing][ArchiveProduct] failed to archive Stripe product: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to archive in Stripe")
		return
	}

	// Mark as archived in database
	_, err = h.db.Exec(`
		UPDATE public.billing_plans
		SET is_archived = true, archived_at = NOW(), is_active = false, updated_at = NOW()
		WHERE id = $1
	`, planID)

	if err != nil {
		log.Printf("[Billing][ArchiveProduct] failed to mark plan as archived: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to archive in database")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Product archived successfully",
		"planId":  planID,
	})
}

// EnsureDefaultPlans checks and syncs the default plans (free, pro, enterprise)
func (h *Handler) EnsureDefaultPlans(ctx context.Context) (int, error) {
	initStripe()
	if stripeClient == nil {
		return 0, fmt.Errorf("Stripe not configured")
	}

	// Find all default plans to ensure they are synced with the correct namespaced Stripe products
	rows, err := h.db.QueryContext(ctx, `
		SELECT id, name, description, price_cents, currency, interval, features, limits, is_custom_price
		FROM public.billing_plans
		WHERE id IN ('free', 'pro', 'enterprise')
	`)
	if err != nil {
		return 0, fmt.Errorf("failed to query legacy plans: %v", err)
	}
	defer rows.Close()

	type LegacyPlan struct {
		ID            string
		Name          string
		Description   *string
		PriceCents    int
		Currency      string
		Interval      string
		Features      []byte
		Limits        []byte
		IsCustomPrice bool
	}

	var legacyPlans []LegacyPlan
	for rows.Next() {
		var plan LegacyPlan
		var desc sql.NullString
		err := rows.Scan(&plan.ID, &plan.Name, &desc, &plan.PriceCents, &plan.Currency, &plan.Interval, &plan.Features, &plan.Limits, &plan.IsCustomPrice)
		if err != nil {
			continue
		}
		if desc.Valid {
			plan.Description = &desc.String
		}
		legacyPlans = append(legacyPlans, plan)
	}

	var syncedCount int
	var errors []string

	for _, plan := range legacyPlans {
		log.Printf("[Billing][EnsureDefaultPlans] Creating Stripe plan for default plan: %s", plan.ID)

		// 1. Check if product already exists in Stripe by plan_id (to avoid duplicates)
		// We filter by 'internal' metadata to ensure we only touch products belonging to this project.
		searchParams := &stripe.ProductSearchParams{}
		searchParams.Query = fmt.Sprintf("active:'true' AND metadata['internal']:'simple-truvis-co' AND metadata['plan_id']:'%s'", plan.ID)
		products := stripeClient.Products.Search(searchParams)

		var product *stripe.Product
		if products.Next() {
			product = products.Product()
			log.Printf("[Billing][EnsureDefaultPlans] Found existing product for %s: %s", plan.ID, product.ID)
		}

		// 2. If not found, create product
		if product == nil {
			productParams := &stripe.ProductParams{
				Name: stripe.String(plan.Name),
				Type: stripe.String(string(stripe.ProductTypeService)),
			}

			if plan.Description != nil && *plan.Description != "" {
				productParams.Description = stripe.String(*plan.Description)
			}

			// Add metadata
			productParams.Metadata = make(map[string]string)
			productParams.Metadata["internal"] = "simple-truvis-co"
			productParams.Metadata["plan_id"] = plan.ID
			if len(plan.Limits) > 0 {
				productParams.Metadata["limits"] = string(plan.Limits)
			}

			var err error
			product, err = stripeClient.Products.New(productParams)
			if err != nil {
				log.Printf("[Billing][EnsureDefaultPlans] failed to create product for %s: %v", plan.ID, err)
				errors = append(errors, fmt.Sprintf("Failed to create product for %s: %v", plan.ID, err))
				continue
			}
		}

		// Ensure product exists in local stripe_products table (FK constraint)
		productID := fmt.Sprintf("prod_%s", product.ID)
		metadataJSON, _ := json.Marshal(product.Metadata)
		_, err := h.db.Exec(`
			INSERT INTO public.stripe_products (id, stripe_product_id, name, description, active, metadata, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			ON CONFLICT (stripe_product_id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				active = EXCLUDED.active,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, productID, product.ID, product.Name, product.Description, product.Active, string(metadataJSON))

		if err != nil {
			log.Printf("[Billing][EnsureDefaultPlans] failed to save stripe_product for %s: %v", plan.ID, err)
			errors = append(errors, fmt.Sprintf("Failed to save stripe_product for %s: %v", plan.ID, err))
			continue
		}

		// For custom priced plans, do not create a Stripe price up-front.
		if plan.IsCustomPrice {
			log.Printf("[Billing][EnsureDefaultPlans] Plan %s is custom-priced; skipping Stripe price creation", plan.ID)
			// Still persist the Stripe product ID for the plan so subscriptions can create per-user prices later.
			_, err = h.db.Exec(`
				UPDATE public.billing_plans
				SET stripe_product_id = $1, is_active = true, updated_at = NOW()
				WHERE id = $2
			`, product.ID, plan.ID)
			if err != nil {
				log.Printf("[Billing][EnsureDefaultPlans] failed to update plan %s with stripe_product_id: %v", plan.ID, err)
				errors = append(errors, fmt.Sprintf("Failed to update plan %s: %v", plan.ID, err))
			} else {
				syncedCount++
				log.Printf("[Billing][EnsureDefaultPlans] Successfully synced custom-priced plan %s -> %s", plan.ID, product.ID)
			}
			continue
		}

		// 3. Check for existing price (simplified: just list prices for product and match amount)
		priceParamsList := &stripe.PriceListParams{}
		priceParamsList.Product = stripe.String(product.ID)
		priceParamsList.Active = stripe.Bool(true)
		prices := stripeClient.Prices.List(priceParamsList)

		var price *stripe.Price
		for prices.Next() {
			p := prices.Price()
			if p.UnitAmount == int64(plan.PriceCents) && string(p.Currency) == plan.Currency && string(p.Recurring.Interval) == plan.Interval {
				price = p
				log.Printf("[Billing][EnsureDefaultPlans] Found existing price for %s: %s", plan.ID, price.ID)
				break
			}
		}

		// 4. Create price if not found
		if price == nil {
			priceParams := &stripe.PriceParams{
				Product:    stripe.String(product.ID),
				UnitAmount: stripe.Int64(int64(plan.PriceCents)),
				Currency:   stripe.String(plan.Currency),
				Nickname:   stripe.String(plan.Name),
				Recurring: &stripe.PriceRecurringParams{
					Interval: stripe.String(plan.Interval),
				},
			}

			var err error
			price, err = stripeClient.Prices.New(priceParams)
			if err != nil {
				log.Printf("[Billing][EnsureDefaultPlans] failed to create price for %s: %v", plan.ID, err)
				errors = append(errors, fmt.Sprintf("Failed to create price for %s: %v", plan.ID, err))
				continue
			}
		}

		// 5. Update the plan in database with real Stripe IDs
		_, err = h.db.Exec(`
			UPDATE public.billing_plans
			SET stripe_price_id = $1, stripe_product_id = $2, is_active = true, updated_at = NOW()
			WHERE id = $3
		`, price.ID, product.ID, plan.ID)

		if err != nil {
			log.Printf("[Billing][EnsureDefaultPlans] failed to update plan %s: %v", plan.ID, err)
			errors = append(errors, fmt.Sprintf("Failed to update plan %s: %v", plan.ID, err))
		} else {
			syncedCount++
			log.Printf("[Billing][EnsureDefaultPlans] Successfully synced plan %s -> %s / %s", plan.ID, product.ID, price.ID)
		}
	}

	if len(errors) > 0 {
		return syncedCount, fmt.Errorf("encountered errors: %s", strings.Join(errors, "; "))
	}
	return syncedCount, nil
}

// EnsureAllPlans ensures all active (non-archived) billing plans are represented in Stripe.
// - For fixed-price plans: ensure Stripe Product + an active Stripe Price exist.
// - For custom-priced plans: ensure Stripe Product exists; do not create a Price up-front.
// It also persists stripe_product_id / stripe_price_id back into billing_plans.
func (h *Handler) EnsureAllPlans(ctx context.Context) (int, error) {
	initStripe()
	if stripeClient == nil {
		return 0, fmt.Errorf("Stripe not configured")
	}

	// Query all active plans. We may not have is_archived in older schemas; treat missing column errors as fatal.
	rows, err := h.db.QueryContext(ctx, `
		SELECT id, name, description, price_cents, currency, interval, limits, is_custom_price
		FROM public.billing_plans
		WHERE is_active = true AND (is_archived = false OR is_archived IS NULL)
		ORDER BY price_cents ASC
	`)
	if err != nil {
		// Fallback for older DBs without is_archived.
		rows, err = h.db.QueryContext(ctx, `
			SELECT id, name, description, price_cents, currency, interval, limits, is_custom_price
			FROM public.billing_plans
			WHERE is_active = true
			ORDER BY price_cents ASC
		`)
		if err != nil {
			return 0, fmt.Errorf("failed to query plans: %v", err)
		}
	}
	defer rows.Close()

	type PlanRow struct {
		ID            string
		Name          string
		Description   *string
		PriceCents    int
		Currency      string
		Interval      string
		Limits        []byte
		IsCustomPrice bool
	}

	var plans []PlanRow
	for rows.Next() {
		var p PlanRow
		var desc sql.NullString
		var limits sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &desc, &p.PriceCents, &p.Currency, &p.Interval, &limits, &p.IsCustomPrice); err != nil {
			continue
		}
		if desc.Valid {
			p.Description = &desc.String
		}
		if limits.Valid {
			p.Limits = []byte(limits.String)
		} else {
			p.Limits = []byte("{}")
		}
		plans = append(plans, p)
	}

	var syncedCount int
	var errs []string

	for _, plan := range plans {
		// 1) Find Stripe product by metadata.plan_id.
		searchParams := &stripe.ProductSearchParams{}
		searchParams.Query = fmt.Sprintf("active:'true' AND metadata['internal']:'simple-truvis-co' AND metadata['plan_id']:'%s'", plan.ID)
		products := stripeClient.Products.Search(searchParams)

		var product *stripe.Product
		if products.Next() {
			product = products.Product()
		}

		// 2) Create product if missing.
		if product == nil {
			productParams := &stripe.ProductParams{
				Name: stripe.String(plan.Name),
				Type: stripe.String(string(stripe.ProductTypeService)),
				Metadata: map[string]string{
					"internal": "simple-truvis-co",
					"plan_id":  plan.ID,
				},
			}
			if plan.Description != nil && *plan.Description != "" {
				productParams.Description = stripe.String(*plan.Description)
			}
			if len(plan.Limits) > 0 {
				productParams.Metadata["limits"] = string(plan.Limits)
			}
			created, err := stripeClient.Products.New(productParams)
			if err != nil {
				errs = append(errs, fmt.Sprintf("plan %s: create product failed: %v", plan.ID, err))
				continue
			}
			product = created
		} else {
			// 3) Keep product metadata up to date.
			productParams := &stripe.ProductParams{}
			productParams.Name = stripe.String(plan.Name)
			if plan.Description != nil && *plan.Description != "" {
				productParams.Description = stripe.String(*plan.Description)
			}
			productParams.Metadata = map[string]string{
				"internal": "simple-truvis-co",
				"plan_id":  plan.ID,
			}
			if len(plan.Limits) > 0 {
				productParams.Metadata["limits"] = string(plan.Limits)
			}
			// Ignore errors here so we can still attempt to reconcile prices.
			_, _ = stripeClient.Products.Update(product.ID, productParams)
		}

		// 4) Upsert local stripe_products row (FK constraint).
		productID := fmt.Sprintf("prod_%s", product.ID)
		metadataJSON, _ := json.Marshal(product.Metadata)
		_, _ = h.db.Exec(`
			INSERT INTO public.stripe_products (id, stripe_product_id, name, description, active, metadata, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			ON CONFLICT (stripe_product_id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				active = EXCLUDED.active,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, productID, product.ID, product.Name, product.Description, product.Active, string(metadataJSON))

		// 5) For custom plans: product only.
		if plan.IsCustomPrice {
			if _, err := h.db.ExecContext(ctx, `
				UPDATE public.billing_plans
				SET stripe_product_id = $1, stripe_price_id = NULL, updated_at = NOW()
				WHERE id = $2
			`, product.ID, plan.ID); err != nil {
				errs = append(errs, fmt.Sprintf("plan %s: persist stripe_product_id failed: %v", plan.ID, err))
				continue
			}
			syncedCount++
			continue
		}

		// 6) Ensure a price exists for this product matching (amount,currency,interval).
		priceParamsList := &stripe.PriceListParams{}
		priceParamsList.Product = stripe.String(product.ID)
		priceParamsList.Active = stripe.Bool(true)
		prices := stripeClient.Prices.List(priceParamsList)
		var price *stripe.Price
		for prices.Next() {
			p := prices.Price()
			if p.UnitAmount == int64(plan.PriceCents) && string(p.Currency) == plan.Currency && p.Recurring != nil && string(p.Recurring.Interval) == plan.Interval {
				price = p
				break
			}
		}
		if price == nil {
			priceParams := &stripe.PriceParams{
				Product:    stripe.String(product.ID),
				UnitAmount: stripe.Int64(int64(plan.PriceCents)),
				Currency:   stripe.String(plan.Currency),
				Nickname:   stripe.String(plan.Name),
				Recurring: &stripe.PriceRecurringParams{
					Interval: stripe.String(plan.Interval),
				},
			}
			created, err := stripeClient.Prices.New(priceParams)
			if err != nil {
				errs = append(errs, fmt.Sprintf("plan %s: create price failed: %v", plan.ID, err))
				continue
			}
			price = created
		}

		// 7) Persist Stripe IDs back to billing_plans.
		if _, err := h.db.ExecContext(ctx, `
			UPDATE public.billing_plans
			SET stripe_product_id = $1, stripe_price_id = $2, updated_at = NOW()
			WHERE id = $3
		`, product.ID, price.ID, plan.ID); err != nil {
			errs = append(errs, fmt.Sprintf("plan %s: persist stripe ids failed: %v", plan.ID, err))
			continue
		}
		syncedCount++
	}

	if len(errs) > 0 {
		return syncedCount, fmt.Errorf("encountered errors: %s", strings.Join(errs, "; "))
	}
	return syncedCount, nil
}

// SyncLegacyPlans creates proper Stripe plans for legacy plans that don't have real Stripe IDs
func (h *Handler) SyncLegacyPlans(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	count, err := h.EnsureDefaultPlans(r.Context())
	if err != nil {
		log.Printf("[Billing][SyncLegacyPlans] error: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":     true,
		"syncedCount": count,
		"message":     fmt.Sprintf("Legacy sync completed! Created Stripe plans for %d legacy plans.", count),
	})
}

// Invoice event handlers
func (h *Handler) handleInvoiceCreated(event stripe.Event) {
	var invoice stripe.Invoice
	err := json.Unmarshal(event.Data.Raw, &invoice)
	if err != nil {
		log.Printf("[Billing][InvoiceCreated] unmarshal error: %v", err)
		return
	}

	// Get user ID from customer
	var userID string
	err = h.db.QueryRow(`
		SELECT user_id FROM public.subscriptions
		WHERE stripe_customer_id = $1
	`, invoice.Customer.ID).Scan(&userID)

	if err != nil {
		log.Printf("[Billing][InvoiceCreated] user lookup error: %v", err)
		return
	}

	// Save invoice record
	invoiceID := fmt.Sprintf("inv_%s", invoice.ID)
	_, err = h.db.Exec(`
		INSERT INTO public.invoices (
			id, user_id, stripe_invoice_id, amount_due, amount_paid, currency, status,
			invoice_pdf, hosted_invoice_url, period_start, period_end, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
		ON CONFLICT (stripe_invoice_id) DO UPDATE SET
			amount_due = EXCLUDED.amount_due,
			amount_paid = EXCLUDED.amount_paid,
			currency = EXCLUDED.currency,
			status = EXCLUDED.status,
			invoice_pdf = EXCLUDED.invoice_pdf,
			hosted_invoice_url = EXCLUDED.hosted_invoice_url,
			period_start = EXCLUDED.period_start,
			period_end = EXCLUDED.period_end
	`, invoiceID, userID, invoice.ID, invoice.AmountDue, invoice.AmountPaid,
		invoice.Currency, invoice.Status, invoice.InvoicePDF, invoice.HostedInvoiceURL,
		inlineNullTime(invoice.PeriodStart), inlineNullTime(invoice.PeriodEnd))

	if err != nil {
		log.Printf("[Billing][InvoiceCreated] invoice save error: %v", err)
	}
}

// Customer event handlers
func (h *Handler) handleCustomerCreated(event stripe.Event) {
	var customer stripe.Customer
	err := json.Unmarshal(event.Data.Raw, &customer)
	if err != nil {
		log.Printf("[Billing][CustomerCreated] unmarshal error: %v", err)
		return
	}

	log.Printf("[Billing][CustomerCreated] Customer created: %s (%s)", customer.ID, customer.Email)
}

func (h *Handler) handleCustomerUpdated(event stripe.Event) {
	var customer stripe.Customer
	err := json.Unmarshal(event.Data.Raw, &customer)
	if err != nil {
		log.Printf("[Billing][CustomerUpdated] unmarshal error: %v", err)
		return
	}

	log.Printf("[Billing][CustomerUpdated] Customer updated: %s (%s)", customer.ID, customer.Email)
}

// SyncStripeProducts syncs all products from Stripe to local database
func (h *Handler) SyncStripeProducts(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	params := &stripe.ProductListParams{}
	params.Filters.AddFilter("active", "true", "true")
	products := stripeClient.Products.List(params)

	var syncedProducts []StripeProduct
	for products.Next() {
		product := products.Product()

		productID := fmt.Sprintf("prod_%s", product.ID)
		_, err := h.db.Exec(`
			INSERT INTO public.stripe_products (id, stripe_product_id, name, description, active, metadata, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			ON CONFLICT (stripe_product_id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				active = EXCLUDED.active,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, productID, product.ID, product.Name, product.Description, product.Active, product.Metadata)

		if err != nil {
			log.Printf("[Billing][SyncProducts] product save error: %v", err)
			continue
		}

		syncedProducts = append(syncedProducts, StripeProduct{
			ID:              productID,
			StripeProductID: product.ID,
			Name:            product.Name,
			Description:     &product.Description,
			Active:          product.Active,
			Metadata:        convertMetadata(product.Metadata),
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		})
	}

	if products.Err() != nil {
		log.Printf("[Billing][SyncProducts] Stripe API error: %v", products.Err())
		writeError(w, http.StatusInternalServerError, "Failed to sync products")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":  "Products synced successfully",
		"count":    len(syncedProducts),
		"products": syncedProducts,
	})
}

// SyncStripePlans syncs all prices from Stripe to local billing plans
func (h *Handler) SyncStripePlans(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	initStripe()
	if stripeClient == nil {
		writeError(w, http.StatusServiceUnavailable, "Stripe not configured")
		return
	}

	params := &stripe.PriceListParams{}
	params.Filters.AddFilter("active", "true", "true")
	prices := stripeClient.Prices.List(params)

	var syncedPlans []BillingPlan
	for prices.Next() {
		price := prices.Price()

		if price.Product == nil || price.Product.ID == "" {
			continue
		}

		planID := fmt.Sprintf("price_%s", price.ID)
		var features, limits map[string]interface{}

		// Get product metadata
		if product, err := stripeClient.Products.Get(price.Product.ID, nil); err == nil {
			features = convertMetadata(product.Metadata)
			limits = convertMetadata(product.Metadata)
		}

		// Convert price from cents (Stripe unit_amount is already in cents)
		priceCents := int(price.UnitAmount)

		_, err := h.db.Exec(`
			INSERT INTO public.billing_plans (id, name, description, price_cents, currency, interval, stripe_price_id, stripe_product_id, features, limits, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				price_cents = EXCLUDED.price_cents,
				currency = EXCLUDED.currency,
				interval = EXCLUDED.interval,
				stripe_price_id = EXCLUDED.stripe_price_id,
				stripe_product_id = EXCLUDED.stripe_product_id,
				features = EXCLUDED.features,
				limits = EXCLUDED.limits,
				updated_at = NOW()
		`, planID, price.Nickname, price.Metadata["description"], priceCents,
			string(price.Currency), string(price.Recurring.Interval), price.ID, price.Product.ID, features, limits)

		if err != nil {
			log.Printf("[Billing][SyncPlans] plan save error: %v", err)
			continue
		}

		syncedPlans = append(syncedPlans, BillingPlan{
			ID:            planID,
			Name:          price.Nickname,
			Description:   getStringFromMap(price.Metadata, "description"),
			PriceCents:    priceCents,
			Currency:      string(price.Currency),
			Interval:      string(price.Recurring.Interval),
			StripePriceID: &price.ID,
			Features:      features,
			Limits:        limits,
			IsActive:      true,
		})
	}

	if prices.Err() != nil {
		log.Printf("[Billing][SyncPlans] Stripe API error: %v", prices.Err())
		writeError(w, http.StatusInternalServerError, "Failed to sync plans")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Plans synced successfully",
		"count":   len(syncedPlans),
		"plans":   syncedPlans,
	})
}

// Helper functions
func convertMetadata(metadata map[string]string) map[string]interface{} {
	result := make(map[string]interface{})
	for k, v := range metadata {
		result[k] = v
	}
	return result
}

func getStringFromMap(m map[string]string, key string) *string {
	if val, exists := m[key]; exists {
		return &val
	}
	return nil
}

// RegisterWebhookRoute registers the webhook endpoint - call this from main.go
func (h *Handler) RegisterWebhookRoute(r interface{}) {
	// This function should be called from main.go to register the webhook route
	// Usage: h.RegisterWebhookRoute(router) where router is a *mux.Router
	// The implementation depends on the router type used in main.go
}
