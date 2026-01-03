-- Revert Teams table column naming back to camelCase

ALTER TABLE public."Teams"
  RENAME COLUMN created_at TO "createdAt";
