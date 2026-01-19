-- +migrate Up
CREATE TABLE IF NOT EXISTS public.custom_plan_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_social_accounts INTEGER NOT NULL DEFAULT 0,
  requested_posts_per_month INTEGER NOT NULL DEFAULT 0,
  requested_storage_gb INTEGER NOT NULL DEFAULT 0,
  notes TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_plan_requests_user_id_created_at
  ON public.custom_plan_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_plan_requests_status_created_at
  ON public.custom_plan_requests (status, created_at DESC);
