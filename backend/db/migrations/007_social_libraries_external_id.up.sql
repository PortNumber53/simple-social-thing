-- Add external_id for idempotent imports from providers (e.g. Instagram media id)
ALTER TABLE public."SocialLibraries"
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Backfill external_id from existing id format if possible (best-effort no-op otherwise)
-- (No deterministic backfill available currently.)

-- Make it easy to upsert by (user_id, network, external_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_libraries_user_network_external
  ON public."SocialLibraries"(user_id, network, external_id)
  WHERE external_id IS NOT NULL;


