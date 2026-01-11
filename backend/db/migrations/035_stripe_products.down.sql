-- +migrate Down
DROP INDEX IF EXISTS idx_billing_plans_stripe_product_id;
DROP INDEX IF EXISTS idx_stripe_products_stripe_product_id;
ALTER TABLE public.billing_plans DROP COLUMN IF EXISTS stripe_product_id;
DROP TABLE IF EXISTS public.stripe_products;
