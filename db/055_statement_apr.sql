-- ===========================================================
-- cashflow :: migration 055 — the APRs a card statement prints (D349)
--
-- Statement-extraction step 4. Every card statement prints its rates by
-- balance type; none was kept. Four standard ones, as columns rather than
-- the facts table step 4 sketched: there are only these four, and the back
-- of the card and the change alerts read them directly. Promotional rates
-- already live in statement_promo. In basis points: 2999 is 29.99%.
-- NULL is "not printed".
-- ===========================================================

BEGIN;

ALTER TABLE statement
  ADD COLUMN apr_purchase_bps          INTEGER CHECK (apr_purchase_bps BETWEEN 0 AND 10000),
  ADD COLUMN apr_balance_transfer_bps  INTEGER CHECK (apr_balance_transfer_bps BETWEEN 0 AND 10000),
  ADD COLUMN apr_cash_advance_bps      INTEGER CHECK (apr_cash_advance_bps BETWEEN 0 AND 10000),
  ADD COLUMN apr_penalty_bps           INTEGER CHECK (apr_penalty_bps BETWEEN 0 AND 10000),
  ADD COLUMN apr_variable              BOOLEAN;

COMMIT;
