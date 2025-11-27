-- Social library: cached copies of user-created content across social networks
CREATE TABLE IF NOT EXISTS public."SocialLibraries" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public."Users"(id) ON DELETE CASCADE,
  network TEXT NOT NULL,              -- e.g. instagram, tiktok, youtube, x, facebook
  content_type TEXT NOT NULL,         -- e.g. post, reel, story, video, music
  title TEXT,
  permalink_url TEXT,
  posted_at TIMESTAMPTZ,              -- when it was posted/published on the network
  views BIGINT,
  likes BIGINT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_id ON public."SocialLibraries"(user_id);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_network ON public."SocialLibraries"(user_id, network);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_type ON public."SocialLibraries"(user_id, content_type);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_posted_at ON public."SocialLibraries"(user_id, posted_at);

