-- +migrate Down
ALTER TABLE public.users DROP COLUMN IF EXISTS profile;
