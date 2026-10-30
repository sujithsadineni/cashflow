-- ===========================================================
-- Login.
--
-- 001_schema.sql's own comment on `person` anticipated this: "later,
-- when we add login, each person gets a row here linked to their
-- credentials." Both columns are nullable -- a person can exist as a
-- pure financial-attribution row (detected from a statement, never
-- uses the app themselves) or as a real login. Not every person
-- needs credentials.
-- ===========================================================

BEGIN;

ALTER TABLE person
  ADD COLUMN username      TEXT UNIQUE,
  ADD COLUMN password_hash TEXT;

COMMIT;
