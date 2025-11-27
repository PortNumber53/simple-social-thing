-- Migration version 5 placeholder (kept for compatibility with existing DBs)
--
-- Some environments already have schema_migrations version=5 recorded, so the
-- golang-migrate runner requires BOTH the `.up.sql` and `.down.sql` files for
-- version 5 to exist on disk at runtime.
--
-- We are NOT using the consolidated `public.user_settings` table; we keep using
-- the legacy public."UserSettings" (user_id, key, value) table instead.
--
-- Make this migration a safe no-op that also ensures `public.user_settings`
-- is removed if it exists.
DROP TABLE IF EXISTS public.user_settings;


