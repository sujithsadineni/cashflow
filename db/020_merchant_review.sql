-- ===========================================================
-- cashflow :: migration 020 — merchant review queue
--
-- A transaction lands here when the merchant-matching pass (see
-- api/src/merchant-review.js) found a plausible but not-confident-
-- enough merchant correction — a description that looks like it
-- might be an existing merchant under different formatting, but not
-- clearly enough to auto-fix. High-confidence matches are applied
-- directly to transaction.merchant and never appear here at all.
--
-- One row per transaction (UNIQUE), so re-running the scan is
-- idempotent — a transaction already flagged, or already resolved,
-- is never flagged twice.
-- ===========================================================

BEGIN;

CREATE TABLE merchant_review (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id      INTEGER NOT NULL UNIQUE REFERENCES transaction(id),
  current_merchant    TEXT,
  suggested_merchant  TEXT NOT NULL,
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, dismissed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX idx_merchant_review_status ON merchant_review(status);

COMMIT;
