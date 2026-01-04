-- Revert Teams table column naming back to camelCase

DO $$
BEGIN
  IF to_regclass('public."Teams"') IS NULL THEN
    RAISE NOTICE 'public."Teams" does not exist; skipping migration 026 down';
    RETURN;
  END IF;

  ALTER TABLE public."Teams"
    RENAME COLUMN created_at TO "createdAt";
END $$;
