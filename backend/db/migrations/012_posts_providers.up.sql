-- Posts: add per-post provider selection (used by Library scheduling UI)

ALTER TABLE public."Posts"
  ADD COLUMN IF NOT EXISTS providers TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
