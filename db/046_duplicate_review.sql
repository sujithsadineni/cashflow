-- ===========================================================
-- cashflow :: migration 046 — duplicate answers (D328)
--
-- Possible duplicates (api/src/review/duplicates.js) are worked out
-- from the ledger each time they're asked for, like the import-time
-- flags (D13), so nothing here lists them. This keeps the one answer
-- that has to be remembered: "both are real", so a pair is never asked
-- again. The other answer, "remove this copy", deletes the copy (D43's
-- path) and the audit log keeps the full row.
--
-- One row per pair, lower id first. When either transaction goes (an
-- import undone), its answers go with it.
-- ===========================================================

BEGIN;

CREATE TABLE duplicate_review (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_a_id INTEGER NOT NULL REFERENCES transaction(id) ON DELETE CASCADE,
  transaction_b_id INTEGER NOT NULL REFERENCES transaction(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'both_real' CHECK (status = 'both_real'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_a_id, transaction_b_id),
  CHECK (transaction_a_id < transaction_b_id)
);

COMMIT;
