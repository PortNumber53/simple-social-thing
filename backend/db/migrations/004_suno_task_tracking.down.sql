-- Rollback task tracking columns
DROP INDEX IF EXISTS idx_suno_tracks_status;
DROP INDEX IF EXISTS idx_suno_tracks_task_id;

ALTER TABLE public."SunoTracks" 
DROP COLUMN IF EXISTS updated_at,
DROP COLUMN IF EXISTS model,
DROP COLUMN IF EXISTS status,
DROP COLUMN IF EXISTS task_id;
