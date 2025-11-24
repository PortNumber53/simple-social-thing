-- Add task_id and status columns to SunoTracks for tracking generation progress
ALTER TABLE public."SunoTracks" 
ADD COLUMN IF NOT EXISTS task_id TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS model TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_suno_tracks_task_id ON public."SunoTracks"(task_id);
CREATE INDEX IF NOT EXISTS idx_suno_tracks_status ON public."SunoTracks"(status);
