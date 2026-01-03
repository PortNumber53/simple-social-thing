-- Revert TeamMembers column naming back to camelCase

ALTER TABLE public."TeamMembers"
  RENAME COLUMN created_at TO "createdAt";
