-- +migrate Up
ALTER TABLE public.users ADD COLUMN profile JSONB;
