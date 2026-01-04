-- Revert providers to NOT NULL with empty array default
-- First, ensure no NULL values exist
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.posts') IS NOT NULL THEN
    t := 'posts';
  ELSIF to_regclass('public."Posts"') IS NOT NULL THEN
    t := 'Posts';
  ELSE
    RAISE NOTICE 'posts table not found (public.posts or public."Posts"); skipping migration 019 down';
    RETURN;
  END IF;

  EXECUTE format('UPDATE public.%I SET providers = ARRAY[]::text[] WHERE providers IS NULL', t);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN providers SET NOT NULL', t);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN providers SET DEFAULT ARRAY[]::text[]', t);
END $$;
