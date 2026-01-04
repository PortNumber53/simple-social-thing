-- Revert Posts table column naming back to camelCase

DO $$
BEGIN
  IF to_regclass('public."Posts"') IS NULL THEN
    RAISE NOTICE 'public."Posts" does not exist; skipping migration 020 down';
    RETURN;
  END IF;

  -- Revert column names.
  ALTER TABLE public."Posts" RENAME COLUMN team_id TO "teamId";
  ALTER TABLE public."Posts" RENAME COLUMN user_id TO "userId";
  ALTER TABLE public."Posts" RENAME COLUMN scheduled_for TO "scheduledFor";
  ALTER TABLE public."Posts" RENAME COLUMN published_at TO "publishedAt";
  ALTER TABLE public."Posts" RENAME COLUMN created_at TO "createdAt";
  ALTER TABLE public."Posts" RENAME COLUMN updated_at TO "updatedAt";
  ALTER TABLE public."Posts" RENAME COLUMN last_publish_job_id TO "lastPublishJobId";
  ALTER TABLE public."Posts" RENAME COLUMN last_publish_status TO "lastPublishStatus";
  ALTER TABLE public."Posts" RENAME COLUMN last_publish_error TO "lastPublishError";
  ALTER TABLE public."Posts" RENAME COLUMN last_publish_attempt_at TO "lastPublishAttemptAt";

  -- Revert indexes.
  DROP INDEX IF EXISTS public.idx_posts_last_publish_job_id;
  CREATE INDEX IF NOT EXISTS idx_posts_last_publish_job_id
    ON public."Posts" ("lastPublishJobId");

  DROP INDEX IF EXISTS public.idx_posts_scheduled;
  CREATE INDEX IF NOT EXISTS idx_posts_scheduled
    ON public."Posts" ("scheduledFor")
    WHERE status = 'scheduled';

  DROP INDEX IF EXISTS public.idx_posts_scheduled_due_claim;
  CREATE INDEX IF NOT EXISTS idx_posts_scheduled_due_claim
    ON public."Posts" ("scheduledFor", "userId", id)
    WHERE status = 'scheduled'
      AND "publishedAt" IS NULL
      AND "lastPublishJobId" IS NULL
      AND "scheduledFor" IS NOT NULL;

  DROP INDEX IF EXISTS public.idx_posts_team_id;
  CREATE INDEX IF NOT EXISTS idx_posts_team_id
    ON public."Posts" ("teamId");

  DROP INDEX IF EXISTS public.idx_posts_user_id;
  CREATE INDEX IF NOT EXISTS idx_posts_user_id
    ON public."Posts" ("userId");

  -- Revert foreign key constraint.
  ALTER TABLE public."Posts"
    DROP CONSTRAINT IF EXISTS "Posts_team_id_fkey";

  ALTER TABLE public."Posts"
    ADD CONSTRAINT "Posts_teamId_fkey"
    FOREIGN KEY ("teamId")
    REFERENCES public."Teams"(id)
    ON DELETE CASCADE;
END $$;
