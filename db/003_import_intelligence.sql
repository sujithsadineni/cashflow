-- ===========================================================
-- cashflow :: migration 003 — import intelligence
--
-- The importer now identifies the account from the statement
-- itself, classifies each transaction's type, cleans merchant
-- names, and suggests categories. Everything here is additive:
-- existing rows keep working with NULLs in the new columns.
--
-- txn_type matters for the numbers: a credit card payment from
-- checking is not spending — the purchases it covers already
-- counted on the card. payment/transfer rows are excluded from
-- spend/earn math.
-- ===========================================================

BEGIN;

ALTER TABLE staged_transaction
  ADD COLUMN merchant TEXT,
  ADD COLUMN txn_type TEXT
    CHECK (txn_type IN ('purchase','refund','payment','transfer','deposit','fee','interest','cashback'));

ALTER TABLE transaction
  ADD COLUMN txn_type TEXT
    CHECK (txn_type IN ('purchase','refund','payment','transfer','deposit','fee','interest','cashback'));

-- What the parser detected about the account, held on the batch
-- until a human confirms it. detected_summary carries the statement
-- summary (period, balances, cashback) so it can be written to the
-- statement table once the account is known.
ALTER TABLE import_batch
  ADD COLUMN detected_account_name TEXT,
  ADD COLUMN detected_issuer TEXT,
  ADD COLUMN detected_mask TEXT,
  ADD COLUMN detected_account_type TEXT,
  ADD COLUMN detected_holder TEXT,
  ADD COLUMN detected_summary JSONB,
  ADD COLUMN suggested_account_id INTEGER REFERENCES account(id);

-- New pipeline stage: parsed, but waiting for a human to confirm
-- which account the statement belongs to.
-- UPLOADED -> PARSING -> NEEDS_ACCOUNT -> REVIEW -> APPROVED
--                    \-> FAILED
ALTER TABLE import_batch DROP CONSTRAINT import_batch_status_check;
ALTER TABLE import_batch ADD CONSTRAINT import_batch_status_check
  CHECK (status IN ('UPLOADED','PARSING','NEEDS_ACCOUNT','REVIEW','APPROVED','FAILED'));

COMMIT;
