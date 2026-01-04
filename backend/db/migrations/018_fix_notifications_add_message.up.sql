-- Add message column to Notifications for backward compatibility with test code
-- This allows using either message (simple) or title+body (structured)
DO $$
DECLARE
  t text;
BEGIN
  -- Support both legacy quoted table names and new snake_case schema.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    t := 'notifications';
  ELSIF to_regclass('public."Notifications"') IS NOT NULL THEN
    t := 'Notifications';
  ELSE
    RAISE NOTICE 'notifications table not found (public.notifications or public."Notifications"); skipping migration 018';
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS message text', t);
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false', t);

  -- Best-effort backfill based on read_at when both columns exist.
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name = t OR table_name = lower(t))
       AND column_name = 'read_at'
  ) AND EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name = t OR table_name = lower(t))
       AND column_name = 'is_read'
  ) THEN
    EXECUTE format('UPDATE public.%I SET is_read = (read_at IS NOT NULL) WHERE is_read IS NULL', t);
  END IF;

  -- Add index when the required columns exist.
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name = t OR table_name = lower(t))
       AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name = t OR table_name = lower(t))
       AND column_name = 'is_read'
  ) THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notifications_user_is_read ON public.%I (user_id, is_read)', t);
  END IF;
END $$;
