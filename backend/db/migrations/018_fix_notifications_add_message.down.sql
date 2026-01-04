-- Remove the added columns
DROP INDEX IF EXISTS public.idx_notifications_user_is_read;

DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    t := 'notifications';
  ELSIF to_regclass('public."Notifications"') IS NOT NULL THEN
    t := 'Notifications';
  ELSE
    RAISE NOTICE 'notifications table not found (public.notifications or public."Notifications"); skipping migration 018 down';
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS is_read', t);
  EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS message', t);
END $$;
