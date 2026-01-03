-- Add title column to SunoTracks for compatibility with test code
-- The table currently only has prompt, but tests expect a title field

ALTER TABLE public."SunoTracks"
  ADD COLUMN IF NOT EXISTS title text;

-- Populate title from prompt for existing records
UPDATE public."SunoTracks"
  SET title = COALESCE(prompt, 'Untitled Track')
  WHERE title IS NULL;
