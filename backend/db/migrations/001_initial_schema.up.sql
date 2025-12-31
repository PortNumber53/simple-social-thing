-- Users
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Social connections
CREATE TABLE IF NOT EXISTS public.social_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    email TEXT,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider),
    UNIQUE(provider, provider_id)
);

-- Teams
CREATE TABLE IF NOT EXISTS public.teams (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    current_tier TEXT,
    posts_created_today INTEGER DEFAULT 0,
    usage_reset_date TIMESTAMPTZ,
    ig_llat TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team members
CREATE TABLE IF NOT EXISTS public.team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT REFERENCES public.teams(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- Posts
CREATE TABLE IF NOT EXISTS public.posts (
    id TEXT PRIMARY KEY,
    team_id TEXT REFERENCES public.teams(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT,
    status TEXT DEFAULT 'draft',
    scheduled_for TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    providers TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    last_publish_job_id TEXT NULL,
    last_publish_status TEXT NULL,
    last_publish_error TEXT NULL,
    last_publish_attempt_at TIMESTAMPTZ NULL,
    media TEXT[] NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Suno tracks
CREATE TABLE IF NOT EXISTS public.suno_tracks (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
    prompt TEXT,
    suno_track_id TEXT,
    audio_url TEXT,
    file_path TEXT,
    task_id TEXT,
    status TEXT DEFAULT 'pending',
    model TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User settings (JSONB)
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);

-- Social libraries
CREATE TABLE IF NOT EXISTS public.social_libraries (
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
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_social_libraries_user_network_external UNIQUE (user_id, network, external_id)
);

-- Social import state/usage
CREATE TABLE IF NOT EXISTS public.social_import_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_social_import_states_user_provider UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.social_import_usage (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  day DATE NOT NULL,
  requests_used BIGINT NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_social_import_usage_provider_day UNIQUE (provider, day)
);

-- Publish jobs
CREATE TABLE IF NOT EXISTS public.publish_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  providers TEXT[] NULL,
  caption TEXT NULL,
  request_json JSONB NULL,
  result_json JSONB NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NULL,
  url         TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at     TIMESTAMPTZ NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_connections_user_id ON public.social_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_social_connections_provider ON public.social_connections(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON public.team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_team_id ON public.posts(team_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON public.posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON public.posts(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_last_publish_job_id ON public.posts(last_publish_job_id);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_due_claim ON public.posts (scheduled_for, user_id, id)
  WHERE status = 'scheduled'
    AND published_at IS NULL
    AND last_publish_job_id IS NULL
    AND scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suno_tracks_user_id ON public.suno_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_suno_tracks_task_id ON public.suno_tracks(task_id);
CREATE INDEX IF NOT EXISTS idx_suno_tracks_status ON public.suno_tracks(status);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON public.user_settings(user_id);

CREATE INDEX IF NOT EXISTS idx_social_libraries_user_id ON public.social_libraries(user_id);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_network ON public.social_libraries(user_id, network);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_type ON public.social_libraries(user_id, content_type);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_posted_at ON public.social_libraries(user_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_social_libraries_user_network_posted_at ON public.social_libraries(user_id, network, posted_at);

CREATE INDEX IF NOT EXISTS idx_social_import_states_next_run ON public.social_import_states(provider, next_run_at);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_user_id_created_at ON public.publish_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_status_created_at ON public.publish_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_at ON public.notifications (user_id, read_at);
