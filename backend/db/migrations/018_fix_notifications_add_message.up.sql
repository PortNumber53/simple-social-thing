-- Add message column to Notifications for backward compatibility with test code
-- This allows using either message (simple) or title+body (structured)
ALTER TABLE public."Notifications"
  ADD COLUMN IF NOT EXISTS message text;

-- Add is_read boolean column for simpler read status checking
ALTER TABLE public."Notifications"
  ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;

-- Update is_read based on read_at for existing records
UPDATE public."Notifications"
  SET is_read = (read_at IS NOT NULL)
  WHERE is_read IS NULL;

-- Create index on is_read for faster queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_is_read
  ON public."Notifications" (user_id, is_read);
