-- +migrate Down

DROP INDEX IF EXISTS public.idx_billing_plans_migrated_from;
DROP INDEX IF EXISTS public.idx_billing_plans_product_version_group;

ALTER TABLE public.billing_plans 
DROP COLUMN IF EXISTS migration_scheduled_at,
DROP COLUMN IF EXISTS migrated_from_plan_id,
DROP COLUMN IF EXISTS product_version_group,
DROP COLUMN IF EXISTS grace_period_months;
