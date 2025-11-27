DROP INDEX IF EXISTS public.idx_social_libraries_user_network_posted_at;

ALTER TABLE public."SocialLibraries"
  DROP COLUMN IF EXISTS thumbnail_url,
  DROP COLUMN IF EXISTS media_url;


