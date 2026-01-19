-- +migrate Up
ALTER TABLE public.billing_plans
ADD COLUMN IF NOT EXISTS is_custom_price BOOLEAN NOT NULL DEFAULT false;
