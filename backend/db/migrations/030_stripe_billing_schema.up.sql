-- +migrate Up
CREATE TABLE public.billing_plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'usd',
    interval VARCHAR(20) NOT NULL DEFAULT 'month',
    stripe_price_id VARCHAR(100),
    features JSONB,
    limits JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE public.subscriptions (
    id VARCHAR(100) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES public.billing_plans(id),
    stripe_subscription_id VARCHAR(100) UNIQUE,
    stripe_customer_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'incomplete',
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    canceled_at TIMESTAMP WITH TIME ZONE,
    trial_start TIMESTAMP WITH TIME ZONE,
    trial_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE TABLE public.billing_events (
    id VARCHAR(100) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    subscription_id VARCHAR(100) REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    stripe_event_id VARCHAR(100) UNIQUE,
    stripe_event_type VARCHAR(100),
    data JSONB,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE public.payment_methods (
    id VARCHAR(100) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_payment_method_id VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(20) NOT NULL,
    last4 VARCHAR(4),
    brand VARCHAR(50),
    exp_month INTEGER,
    exp_year INTEGER,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE public.invoices (
    id VARCHAR(100) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    subscription_id VARCHAR(100) REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    stripe_invoice_id VARCHAR(100) UNIQUE NOT NULL,
    amount_due INTEGER NOT NULL,
    amount_paid INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'usd',
    status VARCHAR(50) NOT NULL,
    invoice_pdf VARCHAR(500),
    hosted_invoice_url VARCHAR(500),
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id);
CREATE INDEX idx_billing_events_user_id ON public.billing_events(user_id);
CREATE INDEX idx_billing_events_stripe_event_id ON public.billing_events(stripe_event_id);
CREATE INDEX idx_payment_methods_user_id ON public.payment_methods(user_id);
CREATE INDEX idx_payment_methods_stripe_payment_method_id ON public.payment_methods(stripe_payment_method_id);
CREATE INDEX idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX idx_invoices_stripe_invoice_id ON public.invoices(stripe_invoice_id);

-- Insert default plans
INSERT INTO public.billing_plans (id, name, description, price_cents, currency, interval, features, limits) VALUES
('free', 'Free', 'Perfect for getting started', 0, 'usd', 'month',
 '{"features": ["5 social accounts", "100 posts/month", "Basic analytics", "Email support"]}',
 '{"social_accounts": 5, "posts_per_month": 100, "analytics": "basic"}'),

('pro', 'Pro', 'For growing creators and businesses', 2900, 'usd', 'month',
 '{"features": ["25 social accounts", "Unlimited posts", "Advanced analytics", "Priority support", "Custom branding", "API access"]}',
 '{"social_accounts": 25, "posts_per_month": -1, "analytics": "advanced"}'),

('enterprise', 'Enterprise', 'For large teams and enterprises', 10000, 'usd', 'month',
 '{"features": ["Unlimited social accounts", "Unlimited posts", "Enterprise analytics", "Dedicated support", "White-label", "Advanced API", "Team management", "Custom integrations"]}',
 '{"social_accounts": -1, "posts_per_month": -1, "analytics": "enterprise"}');
