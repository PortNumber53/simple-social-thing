-- Standardize Users table column naming to snake_case

DO $$
BEGIN
  -- If the snake_case schema already exists, this migration is a no-op.
  IF to_regclass('public.users') IS NOT NULL THEN
    RAISE NOTICE 'public.users exists; skipping legacy Users rename migration 025';
    RETURN;
  END IF;
  IF to_regclass('public."Users"') IS NULL THEN
    RAISE NOTICE 'public."Users" does not exist; skipping migration 025';
    RETURN;
  END IF;

  ALTER TABLE public."Users" RENAME COLUMN "imageUrl" TO image_url;
  ALTER TABLE public."Users" RENAME COLUMN "createdAt" TO created_at;
END $$;
