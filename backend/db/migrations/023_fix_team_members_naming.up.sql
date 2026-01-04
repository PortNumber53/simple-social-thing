-- Standardize TeamMembers table column naming to snake_case

DO $$
BEGIN
  IF to_regclass('public.team_members') IS NOT NULL THEN
    RAISE NOTICE 'public.team_members exists; skipping legacy TeamMembers rename migration 023';
    RETURN;
  END IF;
  IF to_regclass('public."TeamMembers"') IS NULL THEN
    RAISE NOTICE 'public."TeamMembers" does not exist; skipping migration 023';
    RETURN;
  END IF;

  ALTER TABLE public."TeamMembers"
    RENAME COLUMN "createdAt" TO created_at;
END $$;
