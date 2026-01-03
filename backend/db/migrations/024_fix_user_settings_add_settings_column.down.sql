-- Remove the settings column
ALTER TABLE public."UserSettings"
  DROP COLUMN IF EXISTS settings;
