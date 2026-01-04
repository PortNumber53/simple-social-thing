-- Make Notifications.title nullable since message field is preferred

DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    t := 'notifications';
  ELSIF to_regclass('public."Notifications"') IS NOT NULL THEN
    t := 'Notifications';
  ELSE
    RAISE NOTICE 'notifications table not found (public.notifications or public."Notifications"); skipping migration 027';
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN title DROP NOT NULL', t);
END $$;
