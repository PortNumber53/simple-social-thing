-- Track per-user import cursors and network quotas/usage

CREATE TABLE IF NOT EXISTS public."SocialImportStates" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public."Users"(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                   -- instagram, facebook, tiktok, youtube, x, pinterest, threads
  cursor JSONB NOT NULL DEFAULT '{}'::jsonb, -- provider-specific paging cursor/checkpoint
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_import_states_user_provider
  ON public."SocialImportStates"(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_social_import_states_next_run
  ON public."SocialImportStates"(provider, next_run_at);

CREATE TABLE IF NOT EXISTS public."SocialImportUsage" (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  day DATE NOT NULL,                 -- UTC day bucket
  requests_used BIGINT NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_import_usage_provider_day
  ON public."SocialImportUsage"(provider, day);


