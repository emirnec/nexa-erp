-- Safe, repeatable migration: existing motorcycle rows are preserved.
ALTER TABLE IF EXISTS "Motorcycles"
    ADD COLUMN IF NOT EXISTS "ImageUrl" character varying(2048);
