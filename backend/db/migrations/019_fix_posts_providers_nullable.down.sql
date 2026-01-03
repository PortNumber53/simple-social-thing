-- Revert providers to NOT NULL with empty array default
-- First, ensure no NULL values exist
UPDATE public."Posts"
  SET providers = ARRAY[]::text[]
  WHERE providers IS NULL;

-- Restore NOT NULL constraint
ALTER TABLE public."Posts"
  ALTER COLUMN providers SET NOT NULL;

-- Restore default to empty array
ALTER TABLE public."Posts"
  ALTER COLUMN providers SET DEFAULT ARRAY[]::text[];
