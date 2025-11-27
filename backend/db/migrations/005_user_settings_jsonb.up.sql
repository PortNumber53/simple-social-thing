-- Consolidated per-user settings store (JSONB document)
-- This supersedes the legacy public."UserSettings" (user_id, key, value) table.
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id TEXT PRIMARY KEY REFERENCES public."Users"(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON public.user_settings(user_id);

-- Backfill from legacy key/value table if present.
-- Produces a JSON map: { "<key>": <value>, ... } per user.
INSERT INTO public.user_settings (user_id, data, created_at, updated_at)
SELECT
  us.user_id,
  COALESCE(jsonb_object_agg(us.key, us.value), '{}'::jsonb) AS data,
  NOW(),
  NOW()
FROM public."UserSettings" us
GROUP BY us.user_id
ON CONFLICT (user_id) DO NOTHING;


