-- Revert Users table column naming back to camelCase

ALTER TABLE public."Users"
  RENAME COLUMN image_url TO "imageUrl";

ALTER TABLE public."Users"
  RENAME COLUMN created_at TO "createdAt";
