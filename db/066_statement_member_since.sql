-- ===========================================================
-- cashflow :: migration 066 — the "Member since" a statement prints (D393)
--
-- SoFi prints the date the account was opened on every statement
-- ("Member since Mar 24, 2026"). Without it, the months before an
-- account existed read as missing statements (red) on Import and
-- Cards. Kept on the statement, as printed (a value read off a
-- statement is shown, not edited: D297); the account's opening month
-- is the earliest one its statements print.
-- ===========================================================

BEGIN;

ALTER TABLE statement ADD COLUMN member_since date;

COMMIT;
