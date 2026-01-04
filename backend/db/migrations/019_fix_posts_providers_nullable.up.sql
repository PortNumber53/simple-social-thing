-- Make providers column nullable to allow draft posts without specified providers
-- The application can set providers when the post is scheduled/published
DO $$
DECLARE
  t text;
BEGIN
  -- Support both legacy quoted table names and new snake_case schema.
  IF to_regclass('public.posts') IS NOT NULL THEN
    t := 'posts';
  ELSIF to_regclass('public."Posts"') IS NOT NULL THEN
    t := 'Posts';
  ELSE
    RAISE NOTICE 'posts table not found (public.posts or public."Posts"); skipping migration 019';
    RETURN;
  END IF;

  -- Make providers nullable.
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN providers DROP NOT NULL', t);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN providers SET DEFAULT NULL', t);

  -- Update existing empty arrays to NULL for consistency (optional).
  EXECUTE format('UPDATE public.%I SET providers = NULL WHERE providers = ARRAY[]::text[]', t);
END $$;
