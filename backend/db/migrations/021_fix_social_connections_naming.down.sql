-- Revert SocialConnections column naming back to camelCase

DO $$
BEGIN
  IF to_regclass('public."SocialConnections"') IS NULL THEN
    RAISE NOTICE 'public."SocialConnections" does not exist; skipping migration 021 down';
    RETURN;
  END IF;

  ALTER TABLE public."SocialConnections" RENAME COLUMN user_id TO "userId";
  ALTER TABLE public."SocialConnections" RENAME COLUMN provider_id TO "providerId";
  ALTER TABLE public."SocialConnections" RENAME COLUMN created_at TO "createdAt";

  -- Revert indexes.
  DROP INDEX IF EXISTS public.idx_social_connections_user_id;
  CREATE INDEX IF NOT EXISTS idx_social_connections_user_id
    ON public."SocialConnections" ("userId");

  DROP INDEX IF EXISTS public.idx_social_connections_provider;
  CREATE INDEX IF NOT EXISTS idx_social_connections_provider
    ON public."SocialConnections" (provider, "providerId");

  -- Revert unique constraints.
  DROP INDEX IF EXISTS public."SocialConnections_user_id_provider_key";
  CREATE UNIQUE INDEX IF NOT EXISTS "SocialConnections_userId_provider_key"
    ON public."SocialConnections" ("userId", provider);

  -- Revert foreign key.
  ALTER TABLE public."SocialConnections"
    DROP CONSTRAINT IF EXISTS "SocialConnections_user_id_fkey";
  ALTER TABLE public."SocialConnections"
    ADD CONSTRAINT "SocialConnections_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES public."Users"(id)
    ON DELETE CASCADE;
END $$;
