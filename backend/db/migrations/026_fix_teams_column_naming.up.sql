-- Standardize Teams table column naming to snake_case

ALTER TABLE public."Teams"
  RENAME COLUMN "createdAt" TO created_at;
