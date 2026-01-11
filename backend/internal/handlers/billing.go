package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/stripe/stripe-go/v79"
	"github.com/stripe/stripe-go/v79/client"
	"github.com/stripe/stripe-go/v79/webhook"
)

type BillingPlan struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Description *string                `json:"description,omitempty"`
	PriceCents  int                    `json:"priceCents"`
	Currency    string                 `json:"currency"`
	Interval    string                 `json:"interval"`
	StripePriceID *string              `json:"stripePriceId,omitempty"`
	Features    map[string]interface{} `json:"features,omitempty"`
	Limits      map[string]interface{} `json:"limits,omitempty"`
	IsActive    bool                   `json:"isActive"`
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
	ID                       string `json:"id"`
	UserID                   string `json:"userId"`
	StripePaymentMethodID    string `json:"stripePaymentMethodId"`
	Type                     string `json:"type"`
	Last4                    *string `json:"last4,omitempty"`
	Brand                    *string `json:"brand,omitempty"`
	ExpMonth                 *int    `json:"expMonth,omitempty"`
	ExpYear                  *int    `json:"expYear,omitempty"`
	IsDefault                bool    `json:"isDefault"`
	CreatedAt                time.Time `json:"createdAt"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type Invoice struct {
	ID                  string     `json:"id"`
	UserID              string     `json:"userId"`
	StripeInvoiceID     string     `json:"stripeInvoiceId"`
	AmountDue           int        `json:"amountDue"`
	AmountPaid          int        `json:"amountPaid"`
	Currency            string     `json:"currency"`
	Status              string     `json:"status"`
	InvoicePDF          *string    `json:"invoicePdf,omitempty"`
	HostedInvoiceURL    *string    `json:"hostedInvoiceUrl,omitempty"`
	PeriodStart         *time.Time `json:"periodStart,omitempty"`
	PeriodEnd           *time.Time `json:"periodEnd,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
}

type StripeProduct struct {
	ID            string                 `json:"id"`
	StripeProductID string              `json:"stripeProductId"`
	Name          string                 `json:"name"`
	Description   *string                `json:"description,omitempty"`
	Active        bool                   `json:"active"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt     time.Time              `json:"createdAt"`
	UpdatedAt     time.Time              `json:"updatedAt"`
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
		SELECT id, name, description, price_cents, currency, interval, stripe_price_id, is_active
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
		err := rows.Scan(&p.ID, &p.Name, &desc, &p.PriceCents, &p.Currency, &p.Interval, &stripePriceID, &p.IsActive)
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

		plans = append(plans, p)
	}

	if err := rows.Err(); err != nil {
		log.Printf("[Billing][Plans] rows error: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, plans)
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
		SELECT id, user_id, plan_id, stripe_subscription_id, stripe_customer_id, status,
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
		PlanID              string `json:"planId"`
		PaymentMethodID     string `json:"paymentMethodId"`
		PromotionCode       *string `json:"promotionCode,omitempty"`
		TrialDays           *int    `json:"trialDays,omitempty"`
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
	err := h.db.QueryRow(`
		SELECT id, name, price_cents, currency, stripe_price_id
		FROM public.billing_plans
		WHERE id = $1 AND is_active = true
	`, req.PlanID).Scan(&plan.ID, &plan.Name, &plan.PriceCents, &plan.Currency, &plan.StripePriceID)

	if err != nil {
		log.Printf("[Billing][CreateSubscription] plan lookup error userId=%s planId=%s: %v", userID, req.PlanID, err)
		writeError(w, http.StatusBadRequest, "Invalid plan")
		return
	}

	if plan.StripePriceID == nil || *plan.StripePriceID == "" {
		writeError(w, http.StatusBadRequest, "Plan not configured for payment")
		return
	}

	// Check if user already has a subscription
	var existingSubID string
	err = h.db.QueryRow(`SELECT id FROM public.subscriptions WHERE user_id = $1`, userID).Scan(&existingSubID)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("[Billing][CreateSubscription] subscription check error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err == nil {
		// User already has a subscription, update it
		writeError(w, http.StatusBadRequest, "User already has an active subscription")
		return
	}

	// Create Stripe customer and subscription
	// Get or create Stripe customer
	var customerID string
	err = h.db.QueryRow(`SELECT stripe_customer_id FROM public.subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL`, userID).Scan(&customerID)
	if err == sql.ErrNoRows {
		// Create new customer
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
	subID := fmt.Sprintf("sub_%s", subscription.ID)
	_, err = h.db.Exec(`
		INSERT INTO public.subscriptions (
			id, user_id, plan_id, stripe_subscription_id, stripe_customer_id, status,
			current_period_start, current_period_end, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
	`, subID, userID, req.PlanID, subscription.ID, customerID, subscription.Status,
		time.Unix(subscription.CurrentPeriodStart, 0), time.Unix(subscription.CurrentPeriodEnd, 0))

	if err != nil {
		log.Printf("[Billing][CreateSubscription] database save error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Return subscription data with client secret for payment confirmation
	response := map[string]interface{}{
		"subscriptionId":     subID,
		"stripeSubscriptionId": subscription.ID,
		"clientSecret":       subscription.LatestInvoice.PaymentIntent.ClientSecret,
		"status":             subscription.Status,
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
	if req.CancelAtPeriodEnd {
		// For canceling at period end, we need to update the subscription instead of canceling
		updateParams := &stripe.SubscriptionParams{
			CancelAtPeriodEnd: stripe.Bool(true),
		}
		_, err = stripeClient.Subscriptions.Update(stripeSubID, updateParams)
	} else {
		params := &stripe.SubscriptionCancelParams{}
		_, err = stripeClient.Subscriptions.Cancel(stripeSubID, params)
	}
	if err != nil {
		log.Printf("[Billing][CancelSubscription] Stripe cancel error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, "Failed to cancel subscription")
		return
	}

	// Update database
	updateQuery := `
		UPDATE public.subscriptions
		SET cancel_at_period_end = $2, updated_at = NOW()
	`
	args := []interface{}{req.CancelAtPeriodEnd}

	if req.CancelAtPeriodEnd {
		updateQuery += ", canceled_at = NOW()"
		args = append(args, userID)
	} else {
		args = append(args, userID)
	}

	_, err = h.db.Exec(updateQuery+" WHERE user_id = $1", args...)
	if err != nil {
		log.Printf("[Billing][CancelSubscription] database update error userId=%s: %v", userID, err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
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

	writeJSON(w, http.StatusOK, invoices)
}

// StripeWebhook handles Stripe webhook events
func (h *Handler) StripeWebhook(w http.ResponseWriter, r *http.Request) {
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

	// Verify webhook signature
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	if webhookSecret == "" {
		log.Printf("[Billing][Webhook] STRIPE_WEBHOOK_SECRET not set, skipping signature verification")
	} else {
		sig := r.Header.Get("Stripe-Signature")
		if sig == "" {
			log.Printf("[Billing][Webhook] missing Stripe-Signature header")
			writeError(w, http.StatusBadRequest, "Missing signature")
			return
		}

		event, err := webhook.ConstructEvent(payload, sig, webhookSecret)
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
		INSERT INTO public.billing_events (id, stripe_event_id, stripe_event_type, data, created_at)
		VALUES ($1, $2, $3, $4, NOW())
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

	// Price events
	case "price.created", "price.updated":
		h.handlePriceEvent(event)
	case "price.deleted":
		h.handlePriceDeletion(event)

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

	// Update subscription in database
	_, err = h.db.Exec(`
		UPDATE public.subscriptions
		SET status = $2, current_period_start = $3, current_period_end = $4,
		    cancel_at_period_end = $5, updated_at = NOW()
		WHERE stripe_subscription_id = $1
	`, subscription.ID, subscription.Status,
		time.Unix(subscription.CurrentPeriodStart, 0),
		time.Unix(subscription.CurrentPeriodEnd, 0),
		subscription.CancelAtPeriodEnd)

	if err != nil {
		log.Printf("[Billing][SubscriptionEvent] update error: %v", err)
	}
}

func (h *Handler) handleSubscriptionCancellation(event stripe.Event) {
	var subscription stripe.Subscription
	err := json.Unmarshal(event.Data.Raw, &subscription)
	if err != nil {
		log.Printf("[Billing][CancellationEvent] unmarshal error: %v", err)
		return
	}

	// Mark subscription as canceled
	_, err = h.db.Exec(`
		UPDATE public.subscriptions
		SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
		WHERE stripe_subscription_id = $1
	`, subscription.ID)

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

	// Save invoice
	invoiceID := fmt.Sprintf("inv_%s", invoice.ID)
	_, err = h.db.Exec(`
		INSERT INTO public.invoices (
			id, user_id, stripe_invoice_id, amount_due, amount_paid, currency, status,
			invoice_pdf, hosted_invoice_url, period_start, period_end, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
		ON CONFLICT (stripe_invoice_id) DO NOTHING
	`, invoiceID, userID, invoice.ID, invoice.AmountDue, invoice.AmountPaid,
		invoice.Currency, invoice.Status, invoice.InvoicePDF, invoice.HostedInvoiceURL,
		inlineNullTime(invoice.PeriodStart), inlineNullTime(invoice.PeriodEnd))

	if err != nil {
		log.Printf("[Billing][PaymentSuccess] invoice save error: %v", err)
	}
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

// Product event handlers
func (h *Handler) handleProductEvent(event stripe.Event) {
	var product stripe.Product
	err := json.Unmarshal(event.Data.Raw, &product)
	if err != nil {
		log.Printf("[Billing][ProductEvent] unmarshal error: %v", err)
		return
	}

	// Upsert product
	productID := fmt.Sprintf("prod_%s", product.ID)
	_, err = h.db.Exec(`
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
		log.Printf("[Billing][ProductEvent] product save error: %v", err)
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

	// If price is associated with a product, update or create billing plan
	if price.Product != nil && price.Product.ID != "" {
		planID := fmt.Sprintf("price_%s", price.ID)
		var features, limits map[string]interface{}

		// Convert metadata from map[string]string to map[string]interface{}
		if product, err := stripeClient.Products.Get(price.Product.ID, nil); err == nil {
			features = make(map[string]interface{})
			limits = make(map[string]interface{})
			for k, v := range product.Metadata {
				features[k] = v
				limits[k] = v
			}
		}

		// Convert price from dollars to cents
		priceCents := int(price.UnitAmount * 100)

		_, err = h.db.Exec(`
			INSERT INTO public.billing_plans (id, name, description, price_cents, currency, interval, stripe_price_id, stripe_product_id, features, limits, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
			ON CONFLICT (stripe_price_id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				price_cents = EXCLUDED.price_cents,
				currency = EXCLUDED.currency,
				interval = EXCLUDED.interval,
				stripe_product_id = EXCLUDED.stripe_product_id,
				features = EXCLUDED.features,
				limits = EXCLUDED.limits,
				updated_at = NOW()
		`, planID, price.Nickname, price.Metadata["description"], priceCents,
			string(price.Currency), string(price.Recurring.Interval), price.ID, price.Product.ID, features, limits)

		if err != nil {
			log.Printf("[Billing][PriceEvent] plan save error: %v", err)
		}
	}
}

func (h *Handler) handlePriceDeletion(event stripe.Event) {
	var price stripe.Price
	err := json.Unmarshal(event.Data.Raw, &price)
	if err != nil {
		log.Printf("[Billing][PriceDeletion] unmarshal error: %v", err)
		return
	}

	// Deactivate the billing plan
	_, err = h.db.Exec(`
		UPDATE public.billing_plans
		SET is_active = false, updated_at = NOW()
		WHERE stripe_price_id = $1
	`, price.ID)

	if err != nil {
		log.Printf("[Billing][PriceDeletion] plan update error: %v", err)
	}
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
			ID:            productID,
			StripeProductID: product.ID,
			Name:          product.Name,
			Description:   &product.Description,
			Active:        product.Active,
			Metadata:      convertMetadata(product.Metadata),
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		})
	}

	if products.Err() != nil {
		log.Printf("[Billing][SyncProducts] Stripe API error: %v", products.Err())
		writeError(w, http.StatusInternalServerError, "Failed to sync products")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Products synced successfully",
		"count":   len(syncedProducts),
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

		// Convert price from dollars to cents
		priceCents := int(price.UnitAmount * 100)

		_, err := h.db.Exec(`
			INSERT INTO public.billing_plans (id, name, description, price_cents, currency, interval, stripe_price_id, stripe_product_id, features, limits, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
			ON CONFLICT (stripe_price_id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				price_cents = EXCLUDED.price_cents,
				currency = EXCLUDED.currency,
				interval = EXCLUDED.interval,
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
