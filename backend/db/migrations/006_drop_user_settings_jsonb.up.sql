-- Remove the consolidated JSONB user settings table.
-- We keep using the legacy public."UserSettings" (user_id, key, value) table.
DROP TABLE IF EXISTS public.user_settings;


