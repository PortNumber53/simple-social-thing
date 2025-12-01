-- Ensure the worker's Hyperdrive upsert can use `ON CONFLICT (provider, "providerId")`.
-- We already enforce one connection per provider per user via UNIQUE("userId", provider).
-- This additionally enforces that a given provider account id can only exist once per provider.
ALTER TABLE public."SocialConnections"
  ADD CONSTRAINT social_connections_unique_provider_provider_id UNIQUE (provider, "providerId");
