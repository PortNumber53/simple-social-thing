-- Fix ON CONFLICT target by ensuring a proper UNIQUE CONSTRAINT exists.
-- Note: ON CONFLICT column inference cannot rely on a partial unique index.

-- Drop the old partial unique index if it exists
DROP INDEX IF EXISTS public.uq_social_libraries_user_network_external;

-- Add unique constraint (allows multiple NULL external_id values; Postgres treats NULLs as distinct)
DO $$
BEGIN
  ALTER TABLE public."SocialLibraries"
    ADD CONSTRAINT uq_social_libraries_user_network_external UNIQUE (user_id, network, external_id);
EXCEPTION
  WHEN duplicate_object THEN
    -- already exists
    NULL;
END $$;


