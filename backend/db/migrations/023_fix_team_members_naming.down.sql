-- Revert TeamMembers column naming back to camelCase

DO $$
BEGIN
  IF to_regclass('public."TeamMembers"') IS NULL THEN
    RAISE NOTICE 'public."TeamMembers" does not exist; skipping migration 023 down';
    RETURN;
  END IF;

  ALTER TABLE public."TeamMembers"
    RENAME COLUMN created_at TO "createdAt";
END $$;
