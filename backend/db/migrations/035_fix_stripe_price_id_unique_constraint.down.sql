-- +migrate Down
ALTER TABLE public.billing_plans DROP CONSTRAINT IF EXISTS billing_plans_stripe_price_id_unique;
