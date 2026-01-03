-- Standardize SocialConnections table column naming to snake_case

-- Drop constraints first (they depend on the column names)
ALTER TABLE public."SocialConnections"
  DROP CONSTRAINT IF EXISTS "SocialConnections_userId_provider_key";

ALTER TABLE public."SocialConnections"
  DROP CONSTRAINT IF EXISTS social_connections_unique_provider_provider_id;

ALTER TABLE public."SocialConnections"
  DROP CONSTRAINT IF EXISTS "SocialConnections_userId_fkey";

-- Rename columns
ALTER TABLE public."SocialConnections"
  RENAME COLUMN "userId" TO user_id;

ALTER TABLE public."SocialConnections"
  RENAME COLUMN "providerId" TO provider_id;

ALTER TABLE public."SocialConnections"
  RENAME COLUMN "createdAt" TO created_at;

-- Recreate indexes with new column names
DROP INDEX IF EXISTS public.idx_social_connections_user_id;
CREATE INDEX IF NOT EXISTS idx_social_connections_user_id
  ON public."SocialConnections" (user_id);

DROP INDEX IF EXISTS public.idx_social_connections_provider;
CREATE INDEX IF NOT EXISTS idx_social_connections_provider
  ON public."SocialConnections" (provider, provider_id);

-- Recreate unique constraints with new column names
ALTER TABLE public."SocialConnections"
  ADD CONSTRAINT "SocialConnections_user_id_provider_key"
  UNIQUE (user_id, provider);

ALTER TABLE public."SocialConnections"
  ADD CONSTRAINT social_connections_unique_provider_provider_id
  UNIQUE (provider, provider_id);

-- Recreate foreign key with new column name
ALTER TABLE public."SocialConnections"
  ADD CONSTRAINT "SocialConnections_user_id_fkey"
  FOREIGN KEY (user_id)
  REFERENCES public."Users"(id)
  ON DELETE CASCADE;
