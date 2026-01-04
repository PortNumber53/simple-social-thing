-- Revert Notifications.title back to NOT NULL

-- First set any NULL titles to empty string
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    t := 'notifications';
  ELSIF to_regclass('public."Notifications"') IS NOT NULL THEN
    t := 'Notifications';
  ELSE
    RAISE NOTICE 'notifications table not found (public.notifications or public."Notifications"); skipping migration 027 down';
    RETURN;
  END IF;

  EXECUTE format('UPDATE public.%I SET title = '''' WHERE title IS NULL', t);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN title SET NOT NULL', t);
END $$;
