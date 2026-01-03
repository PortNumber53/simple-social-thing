-- Remove the added columns
DROP INDEX IF EXISTS public.idx_notifications_user_is_read;

ALTER TABLE public."Notifications"
  DROP COLUMN IF EXISTS is_read;

ALTER TABLE public."Notifications"
  DROP COLUMN IF EXISTS message;
