-- Standardize TeamMembers table column naming to snake_case

ALTER TABLE public."TeamMembers"
  RENAME COLUMN "createdAt" TO created_at;
