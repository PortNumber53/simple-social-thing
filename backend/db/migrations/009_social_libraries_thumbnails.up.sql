-- Add media_url + thumbnail_url for gallery display
ALTER TABLE public."SocialLibraries"
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE INDEX IF NOT EXISTS idx_social_libraries_user_network_posted_at
  ON public."SocialLibraries"(user_id, network, posted_at);


