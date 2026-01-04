-- Standardize Posts table column naming to snake_case for consistency
-- This matches the pattern used in other tables (Teams, SocialConnections, etc.)

DO $$
BEGIN
  -- If the snake_case schema already exists, this migration is a no-op.
  IF to_regclass('public.posts') IS NOT NULL THEN
    RAISE NOTICE 'public.posts exists; skipping legacy Posts column rename migration 020';
    RETURN;
  END IF;
  IF to_regclass('public."Posts"') IS NULL THEN
    RAISE NOTICE 'public."Posts" does not exist; skipping migration 020';
    RETURN;
  END IF;

  -- Rename camelCase columns to snake_case (legacy quoted table only).
  ALTER TABLE public."Posts" RENAME COLUMN "teamId" TO team_id;
  ALTER TABLE public."Posts" RENAME COLUMN "userId" TO user_id;
  ALTER TABLE public."Posts" RENAME COLUMN "scheduledFor" TO scheduled_for;
  ALTER TABLE public."Posts" RENAME COLUMN "publishedAt" TO published_at;
  ALTER TABLE public."Posts" RENAME COLUMN "createdAt" TO created_at;
  ALTER TABLE public."Posts" RENAME COLUMN "updatedAt" TO updated_at;
  ALTER TABLE public."Posts" RENAME COLUMN "lastPublishJobId" TO last_publish_job_id;
  ALTER TABLE public."Posts" RENAME COLUMN "lastPublishStatus" TO last_publish_status;
  ALTER TABLE public."Posts" RENAME COLUMN "lastPublishError" TO last_publish_error;
  ALTER TABLE public."Posts" RENAME COLUMN "lastPublishAttemptAt" TO last_publish_attempt_at;

  -- Update index names to match new column names.
  DROP INDEX IF EXISTS public.idx_posts_last_publish_job_id;
  CREATE INDEX IF NOT EXISTS idx_posts_last_publish_job_id
    ON public."Posts" (last_publish_job_id);

  DROP INDEX IF EXISTS public.idx_posts_scheduled;
  CREATE INDEX IF NOT EXISTS idx_posts_scheduled
    ON public."Posts" (scheduled_for)
    WHERE status = 'scheduled';

  DROP INDEX IF EXISTS public.idx_posts_scheduled_due_claim;
  CREATE INDEX IF NOT EXISTS idx_posts_scheduled_due_claim
    ON public."Posts" (scheduled_for, user_id, id)
    WHERE status = 'scheduled'
      AND published_at IS NULL
      AND last_publish_job_id IS NULL
      AND scheduled_for IS NOT NULL;

  DROP INDEX IF EXISTS public.idx_posts_team_id;
  CREATE INDEX IF NOT EXISTS idx_posts_team_id
    ON public."Posts" (team_id);

  DROP INDEX IF EXISTS public.idx_posts_user_id;
  CREATE INDEX IF NOT EXISTS idx_posts_user_id
    ON public."Posts" (user_id);

  -- Update foreign key constraint if it exists.
  ALTER TABLE public."Posts"
    DROP CONSTRAINT IF EXISTS "Posts_teamId_fkey";

  ALTER TABLE public."Posts"
    ADD CONSTRAINT "Posts_team_id_fkey"
    FOREIGN KEY (team_id)
    REFERENCES public."Teams"(id)
    ON DELETE CASCADE;
END $$;
