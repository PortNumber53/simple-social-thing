-- Ensure social_libraries exists for databases that predate schema consolidation into 001.
-- This is safe to run on already-migrated DBs (no-op when table/objects exist).

DO $$
BEGIN
  IF to_regclass('public.social_libraries') IS NULL THEN
    CREATE TABLE public.social_libraries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      network TEXT NOT NULL,
      content_type TEXT NOT NULL,
      title TEXT,
      permalink_url TEXT,
      posted_at TIMESTAMPTZ,
      views BIGINT,
      likes BIGINT,
      media_url TEXT,
      thumbnail_url TEXT,
      external_id TEXT,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.social_libraries') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'uq_social_libraries_user_network_external'
     )
  THEN
    ALTER TABLE public.social_libraries
      ADD CONSTRAINT uq_social_libraries_user_network_external UNIQUE (user_id, network, external_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_social_libraries_user_id ON public.social_libraries(user_id);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_network ON public.social_libraries(user_id, network);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_type ON public.social_libraries(user_id, content_type);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_posted_at ON public.social_libraries(user_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_network_posted_at ON public.social_libraries(user_id, network, posted_at);

