-- Add title column to SunoTracks for compatibility with test code
-- The table currently only has prompt, but tests expect a title field

DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('public.suno_tracks') IS NOT NULL THEN
    t := 'suno_tracks';
  ELSIF to_regclass('public."SunoTracks"') IS NOT NULL THEN
    t := 'SunoTracks';
  ELSE
    RAISE NOTICE 'suno_tracks table not found (public.suno_tracks or public."SunoTracks"); skipping migration 022';
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS title text', t);
  EXECUTE format('UPDATE public.%I SET title = COALESCE(prompt, ''Untitled Track'') WHERE title IS NULL', t);
END $$;
