-- Posts: track publish attempt for scheduled posts (avoid duplicate processing + expose last result)

ALTER TABLE public."Posts"
  ADD COLUMN IF NOT EXISTS "lastPublishJobId" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "lastPublishStatus" TEXT NULL, -- queued | running | completed | failed
  ADD COLUMN IF NOT EXISTS "lastPublishError" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "lastPublishAttemptAt" TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_posts_last_publish_job_id ON public."Posts"("lastPublishJobId");
