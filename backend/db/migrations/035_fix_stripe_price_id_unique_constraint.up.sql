-- +migrate Up
-- First, handle existing NULL values by making them unique temporary values
UPDATE public.billing_plans
SET stripe_price_id = 'legacy_' || id
WHERE stripe_price_id IS NULL AND id NOT LIKE 'legacy_%';

-- Now add the unique constraint allowing NULL values
ALTER TABLE public.billing_plans ADD CONSTRAINT billing_plans_stripe_price_id_unique UNIQUE (stripe_price_id);

-- +migrate Down
ALTER TABLE public.billing_plans DROP CONSTRAINT IF EXISTS billing_plans_stripe_price_id_unique;
