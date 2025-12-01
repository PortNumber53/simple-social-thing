-- Speed up scheduled-posts sweeps and reduce Postgres memory pressure by avoiding large sorts/scans.
-- This index matches the worker predicate and supports ORDER BY scheduledFor.

CREATE INDEX IF NOT EXISTS idx_posts_scheduled_due_claim
  ON public."Posts" ("scheduledFor", "userId", id)
 WHERE status = 'scheduled'
   AND "publishedAt" IS NULL
   AND "lastPublishJobId" IS NULL
   AND "scheduledFor" IS NOT NULL;
