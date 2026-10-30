-- ===========================================================
-- cashflow :: migration 006 — account holder name
--
-- The card carousel shows the name printed on the statement
-- ("ALEX JAMES MORGAN"), not just the short person name used
-- elsewhere in the app ("Alex") — a real card shows the full
-- name as printed, and we already capture it during PDF extraction
-- (import_batch.detected_holder). This just gives it a permanent
-- home on the account.
-- ===========================================================

BEGIN;

ALTER TABLE account ADD COLUMN holder_name TEXT;

COMMIT;
