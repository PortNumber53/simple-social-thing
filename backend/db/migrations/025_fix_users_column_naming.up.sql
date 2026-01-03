-- Standardize Users table column naming to snake_case

ALTER TABLE public."Users"
  RENAME COLUMN "imageUrl" TO image_url;

ALTER TABLE public."Users"
  RENAME COLUMN "createdAt" TO created_at;
