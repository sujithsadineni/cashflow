-- ===========================================================
-- cashflow :: migration 056 — an alert when a card's terms change (D349)
--
-- Statement-extraction step 4: a card's newest statement printing a
-- different purchase APR or credit limit from the one before is worth
-- telling the household about. A new alert type, kept by month like the
-- others (db/022).
-- ===========================================================

BEGIN;

ALTER TABLE alert DROP CONSTRAINT alert_type_check;
ALTER TABLE alert ADD CONSTRAINT alert_type_check CHECK (type IN (
  'OVERDUE_STATEMENT', 'MISSED_RECURRING', 'NEW_RECURRING', 'PENDING_REVIEW', 'CARD_PAYMENT_DUE', 'CARD_TERMS_CHANGED'));

COMMIT;
