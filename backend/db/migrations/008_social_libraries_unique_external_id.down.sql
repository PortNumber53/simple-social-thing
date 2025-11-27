-- Roll back: remove the unique constraint and (re)create the old partial unique index.
ALTER TABLE public."SocialLibraries"
  DROP CONSTRAINT IF EXISTS uq_social_libraries_user_network_external;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_libraries_user_network_external
  ON public."SocialLibraries"(user_id, network, external_id)
  WHERE external_id IS NOT NULL;


