-- Remove title column from SunoTracks
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.suno_tracks') IS NOT NULL THEN
    t := 'suno_tracks';
  ELSIF to_regclass('public."SunoTracks"') IS NOT NULL THEN
    t := 'SunoTracks';
  ELSE
    RAISE NOTICE 'suno_tracks table not found (public.suno_tracks or public."SunoTracks"); skipping migration 022 down';
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS title', t);
END $$;
