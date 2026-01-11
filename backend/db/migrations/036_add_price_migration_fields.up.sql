-- +migrate Up

-- Add grace period and product version group fields to billing_plans
ALTER TABLE public.billing_plans
ADD COLUMN IF NOT EXISTS grace_period_months INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS product_version_group TEXT,
ADD COLUMN IF NOT EXISTS migrated_from_plan_id TEXT,
ADD COLUMN IF NOT EXISTS migration_scheduled_at TIMESTAMP;

-- Create index for product_version_group for efficient reporting
CREATE INDEX IF NOT EXISTS idx_billing_plans_product_version_group
ON public.billing_plans(product_version_group);

-- Create index for migration tracking
CREATE INDEX IF NOT EXISTS idx_billing_plans_migrated_from
ON public.billing_plans(migrated_from_plan_id);
