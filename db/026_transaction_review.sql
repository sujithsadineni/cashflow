-- ===========================================================
-- cashflow :: migration 026 — transaction_review
-- ===========================================================
--
-- Findings from the re-check (D175): a saved transaction whose type
-- or category today's rules disagree with. Each one waits here for a
-- person, in the Review tab on Transactions. Nothing is changed until
-- they approve it.
--
-- One row per (transaction, check): a re-run never asks the same
-- question twice. A dismissed finding stays dismissed, and a pending
-- one that no longer applies (the row was fixed elsewhere) becomes
-- 'obsolete' rather than being deleted.

CREATE TABLE transaction_review (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id   INTEGER NOT NULL REFERENCES transaction(id),
  check_kind       TEXT NOT NULL,
  field            TEXT NOT NULL CHECK (field IN ('txn_type', 'category')),
  current_value    TEXT,
  suggested_value  TEXT,
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'dismissed', 'obsolete')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  UNIQUE (transaction_id, check_kind)
);

CREATE INDEX idx_transaction_review_status ON transaction_review (status);
