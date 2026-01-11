package handlers

import (
	"github.com/gorilla/mux"
)

// RegisterBillingRoutes registers all billing-related routes
func RegisterBillingRoutes(h *Handler, r *mux.Router) {
	// Existing billing routes
	r.HandleFunc("/api/billing/plans", h.GetBillingPlans).Methods("GET")
	r.HandleFunc("/api/billing/plans/{id}", h.UpdateBillingPlan).Methods("PUT")
	r.HandleFunc("/api/billing/subscription/user/{userId}", h.GetUserSubscription).Methods("GET")
	r.HandleFunc("/api/billing/subscription/user/{userId}", h.CreateSubscription).Methods("POST")
	r.HandleFunc("/api/billing/subscription/cancel/user/{userId}", h.CancelSubscription).Methods("POST")
	r.HandleFunc("/api/billing/invoices/user/{userId}", h.GetUserInvoices).Methods("GET")

	// Stripe webhook endpoint - updated to match requested path
	r.HandleFunc("/webhook/stripe", h.StripeWebhook).Methods("POST")

	// New sync endpoints for Stripe integration
	r.HandleFunc("/api/billing/sync/products", h.SyncStripeProducts).Methods("POST")
	r.HandleFunc("/api/billing/sync/plans", h.SyncStripePlans).Methods("POST")
}
