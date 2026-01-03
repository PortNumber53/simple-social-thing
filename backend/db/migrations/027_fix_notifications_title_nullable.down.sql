-- Revert Notifications.title back to NOT NULL

-- First set any NULL titles to empty string
UPDATE public."Notifications"
  SET title = ''
  WHERE title IS NULL;

ALTER TABLE public."Notifications"
  ALTER COLUMN title SET NOT NULL;
