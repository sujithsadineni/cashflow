-- ===========================================================
-- cashflow :: migration 065 — indexes on import_batch_id (D389)
--
-- The Import page's statement list sums each statement's saved rows
-- (transaction.import_batch_id) and finds its summary
-- (statement.import_batch_id). Neither column had an index, so with
-- 462 statements each lookup read the whole table: about 195 ms for
-- the list on 5,177 transactions, growing with every statement.
-- staged_transaction already has one (idx_staged_batch).
-- ===========================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_txn_import_batch ON transaction (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_statement_import_batch ON statement (import_batch_id) WHERE import_batch_id IS NOT NULL;

COMMIT;
