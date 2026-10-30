-- ===========================================================
-- cashflow :: migration 027 — a re-check finding can be about an amount
-- ===========================================================
--
-- D178: a row recorded with the wrong sign (a $28,500 balance transfer
-- read as a credit instead of new debt) is found by the re-check when
-- flipping exactly that one row makes its statement add up to the
-- cent. Approving it flips the amount, audited.

ALTER TABLE transaction_review DROP CONSTRAINT transaction_review_field_check;
ALTER TABLE transaction_review ADD CONSTRAINT transaction_review_field_check
  CHECK (field IN ('txn_type', 'category', 'amount'));
