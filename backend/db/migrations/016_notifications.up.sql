CREATE TABLE IF NOT EXISTS public."Notifications" (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NULL,
  url         text NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  read_at     timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON public."Notifications" (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_at
  ON public."Notifications" (user_id, read_at);
