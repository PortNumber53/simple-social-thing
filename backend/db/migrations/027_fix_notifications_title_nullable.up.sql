-- Make Notifications.title nullable since message field is preferred

ALTER TABLE public."Notifications"
  ALTER COLUMN title DROP NOT NULL;
