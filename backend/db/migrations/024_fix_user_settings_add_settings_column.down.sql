-- Remove the settings column
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    t := 'user_settings';
  ELSIF to_regclass('public."UserSettings"') IS NOT NULL THEN
    t := 'UserSettings';
  ELSE
    RAISE NOTICE 'user_settings table not found (public.user_settings or public."UserSettings"); skipping migration 024 down';
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS settings', t);
END $$;
