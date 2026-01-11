-- +migrate Down
ALTER TABLE public.billing_events ALTER COLUMN user_id SET NOT NULL;
