-- Make providers column nullable to allow draft posts without specified providers
-- The application can set providers when the post is scheduled/published
ALTER TABLE public."Posts"
  ALTER COLUMN providers DROP NOT NULL;

-- Set default to NULL instead of empty array for new records
ALTER TABLE public."Posts"
  ALTER COLUMN providers SET DEFAULT NULL;

-- Update existing empty arrays to NULL for consistency (optional)
UPDATE public."Posts"
  SET providers = NULL
  WHERE providers = ARRAY[]::text[];
