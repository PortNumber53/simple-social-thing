-- Posts: remove scheduled publish attempt tracking columns

DROP INDEX IF EXISTS idx_posts_last_publish_job_id;

ALTER TABLE public."Posts"
  DROP COLUMN IF EXISTS "lastPublishJobId",
  DROP COLUMN IF EXISTS "lastPublishStatus",
  DROP COLUMN IF EXISTS "lastPublishError",
  DROP COLUMN IF EXISTS "lastPublishAttemptAt";
