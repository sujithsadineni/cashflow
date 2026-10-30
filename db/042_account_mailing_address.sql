-- ===========================================================
-- cashflow :: migration 042 — the mailing address a statement prints (D302)
--
-- The People page shows what the household's statements say about each
-- person; the address they're mailed to was the one thing never kept. It's
-- read off the first page of an account's newest PDF statement
-- (statements/mailing-address.js), on approval and once as a backfill, and
-- kept per account with the statement it came from, so the page can say
-- "from the Chase statement ending Oct 5" and show two addresses when two
-- accounts disagree (a move, a second unit).
--
-- Personal data: local only, never published, masked in privacy mode.
-- Null when a bank doesn't print a mailing block on page one (several don't).
-- ===========================================================

BEGIN;

ALTER TABLE account
  ADD COLUMN statement_address TEXT,
  ADD COLUMN statement_address_as_of DATE;

COMMIT;
