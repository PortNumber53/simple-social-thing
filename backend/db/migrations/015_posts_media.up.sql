-- Store media references (public rel paths like `/media/<userhash>/<shard>/<file>.<ext>`)
-- on local draft/scheduled Posts so scheduled publishing can include required media URLs.
ALTER TABLE public."Posts"
  ADD COLUMN IF NOT EXISTS media text[];
