-- ===========================================================
-- Login, removed. The household decided against an auth layer --
-- this is a shared household ledger on localhost, not per-user
-- data, and the username/password_hash columns 017_person_auth.sql
-- added had no other use in the schema. See D104 in DECISIONS.md.
-- ===========================================================

BEGIN;

ALTER TABLE person
  DROP COLUMN username,
  DROP COLUMN password_hash;

COMMIT;
