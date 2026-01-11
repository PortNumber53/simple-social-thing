-- +migrate Up
ALTER TABLE public.billing_plans ADD CONSTRAINT billing_plans_stripe_price_id_unique UNIQUE (stripe_price_id);

-- +migrate Down
ALTER TABLE public.billing_plans DROP CONSTRAINT IF EXISTS billing_plans_stripe_price_id_unique;
