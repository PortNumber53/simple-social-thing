DROP INDEX IF EXISTS public.uq_social_libraries_user_network_external;

ALTER TABLE public."SocialLibraries"
  DROP COLUMN IF EXISTS external_id;


