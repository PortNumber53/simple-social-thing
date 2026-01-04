-- Revert Users table column naming back to camelCase

DO $$
BEGIN
  IF to_regclass('public."Users"') IS NULL THEN
    RAISE NOTICE 'public."Users" does not exist; skipping migration 025 down';
    RETURN;
  END IF;

  ALTER TABLE public."Users" RENAME COLUMN image_url TO "imageUrl";
  ALTER TABLE public."Users" RENAME COLUMN created_at TO "createdAt";
END $$;
