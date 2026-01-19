-- +migrate Down
ALTER TABLE public.billing_plans
DROP COLUMN IF EXISTS is_custom_price;
