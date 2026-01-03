-- Remove title column from SunoTracks
ALTER TABLE public."SunoTracks"
  DROP COLUMN IF EXISTS title;
