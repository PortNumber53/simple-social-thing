package main

import (
	"database/sql"
	"log"
	"os"

	_ "github.com/lib/pq"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL not set")
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Check existing plans
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM public.billing_plans").Scan(&count)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Found %d plans in database", count)

	if count == 0 {
		log.Println("Inserting default plans...")

		plans := []struct {
			id, name, desc string
			price          int
			features, limits string
		}{
			{
				id:       "free",
				name:     "Free",
				desc:     "Perfect for getting started",
				price:    0,
				features: `{"features": ["5 social accounts", "100 posts/month", "Basic analytics", "Email support"]}`,
				limits:   `{"social_accounts": 5, "posts_per_month": 100, "analytics": "basic"}`,
			},
			{
				id:       "pro",
				name:     "Pro",
				desc:     "For growing creators and businesses",
				price:    2900,
				features: `{"features": ["25 social accounts", "Unlimited posts", "Advanced analytics", "Priority support", "Custom branding", "API access"]}`,
				limits:   `{"social_accounts": 25, "posts_per_month": -1, "analytics": "advanced"}`,
			},
			{
				id:       "enterprise",
				name:     "Enterprise",
				desc:     "For large teams and enterprises",
				price:    10000,
				features: `{"features": ["Unlimited social accounts", "Unlimited posts", "Enterprise analytics", "Dedicated support", "White-label", "Advanced API", "Team management", "Custom integrations"]}`,
				limits:   `{"social_accounts": -1, "posts_per_month": -1, "analytics": "enterprise"}`,
			},
		}

		for _, plan := range plans {
			_, err = db.Exec(`
				INSERT INTO public.billing_plans (id, name, description, price_cents, currency, interval, features, limits)
				VALUES ($1, $2, $3, $4, 'usd', 'month', $5::jsonb, $6::jsonb)
				ON CONFLICT (id) DO NOTHING
			`, plan.id, plan.name, plan.desc, plan.price, plan.features, plan.limits)
			if err != nil {
				log.Printf("Error inserting %s plan: %v", plan.id, err)
			} else {
				log.Printf("Inserted %s plan", plan.id)
			}
		}

		log.Println("Default plans inserted successfully!")
	} else {
		log.Println("Plans already exist, skipping insertion")
	}

	// List all plans
	rows, err := db.Query("SELECT id, name, price_cents FROM public.billing_plans ORDER BY price_cents")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	log.Println("\nCurrent plans:")
	for rows.Next() {
		var id, name string
		var price int
		rows.Scan(&id, &name, &price)
		log.Printf("- %s: %s ($%d/month)", id, name, price/100)
	}
}
