-- Per-user key/value settings (JSONB)
CREATE TABLE IF NOT EXISTS public."UserSettings" (
	user_id TEXT NOT NULL REFERENCES public."Users"(id) ON DELETE CASCADE,
	key TEXT NOT NULL,
	value JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON public."UserSettings"(user_id);
