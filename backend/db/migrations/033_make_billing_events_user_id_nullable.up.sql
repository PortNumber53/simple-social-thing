-- Make user_id nullable in billing_events for webhook events
-- +migrate Up
ALTER TABLE public.billing_events ALTER COLUMN user_id DROP NOT NULL;

-- Add comment to explain why it's nullable
COMMENT ON COLUMN public.billing_events.user_id IS 'Nullable for webhook events that dont have a specific user';
