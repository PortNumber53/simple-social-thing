-- Suno-generated tracks
CREATE TABLE IF NOT EXISTS public."SunoTracks" (
	id TEXT PRIMARY KEY,
	user_id TEXT REFERENCES public."Users"(id) ON DELETE SET NULL,
	prompt TEXT,
	suno_track_id TEXT,
	audio_url TEXT,
	file_path TEXT,
	created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suno_tracks_user_id ON public."SunoTracks"(user_id);
