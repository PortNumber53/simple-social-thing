-- Publish jobs: async background publishing + progress tracking

CREATE TABLE IF NOT EXISTS public."PublishJobs" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public."Users"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | completed | failed
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

CREATE INDEX IF NOT EXISTS "idx_publish_jobs_user_id_created_at"
  ON public."PublishJobs"(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS "idx_publish_jobs_status_created_at"
  ON public."PublishJobs"(status, created_at DESC);


