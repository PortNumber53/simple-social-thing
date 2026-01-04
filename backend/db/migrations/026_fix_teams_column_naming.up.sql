-- Standardize Teams table column naming to snake_case

DO $$
BEGIN
  -- If the snake_case schema already exists, this migration is a no-op.
  IF to_regclass('public.teams') IS NOT NULL THEN
    RAISE NOTICE 'public.teams exists; skipping legacy Teams rename migration 026';
    RETURN;
  END IF;
  IF to_regclass('public."Teams"') IS NULL THEN
    RAISE NOTICE 'public."Teams" does not exist; skipping migration 026';
    RETURN;
  END IF;

  ALTER TABLE public."Teams"
    RENAME COLUMN "createdAt" TO created_at;
END $$;
