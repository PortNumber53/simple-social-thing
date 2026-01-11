-- +migrate Down
DROP INDEX IF EXISTS idx_billing_plans_is_archived;
DROP INDEX IF EXISTS idx_billing_plans_migrated_from_plan_id;
DROP INDEX IF EXISTS idx_billing_plans_product_version_group;

ALTER TABLE public.billing_plans DROP COLUMN archived_at;
ALTER TABLE public.billing_plans DROP COLUMN is_archived;
