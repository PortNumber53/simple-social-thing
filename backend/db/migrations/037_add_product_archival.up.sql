-- +migrate Up
ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

-- Create indexes (using IF NOT EXISTS to handle potential conflicts)
CREATE INDEX IF NOT EXISTS idx_billing_plans_product_version_group ON public.billing_plans(product_version_group);
CREATE INDEX IF NOT EXISTS idx_billing_plans_migrated_from_plan_id ON public.billing_plans(migrated_from_plan_id);
CREATE INDEX IF NOT EXISTS idx_billing_plans_is_archived ON public.billing_plans(is_archived);
