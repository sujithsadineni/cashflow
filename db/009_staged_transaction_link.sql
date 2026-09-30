-- ===========================================================
-- cashflow :: migration 009 — link a staged row to its real transaction
--
-- Once a statement is approved, its Review screen still shows the
-- staged rows (now marked APPROVED) as a read-only record of what
-- happened. But "read-only" turned out to be a real gap: there was no
-- way to fix a category or type mistake from that screen, and even if
-- there were, staged_transaction has no link back to which row in
-- `transaction` it became — editing the staged row's own fields would
-- update a frozen parse-time snapshot nobody else in the app reads,
-- not the live ledger.
--
-- transaction_id closes that gap: set once, at approval, never
-- changed after. It lets the statement view PATCH the real
-- transaction (same endpoint the main ledger already uses), so an
-- edit made from either screen is the same edit, visible everywhere.
-- ===========================================================

BEGIN;

ALTER TABLE staged_transaction
  ADD COLUMN transaction_id INTEGER REFERENCES transaction(id);

COMMIT;
