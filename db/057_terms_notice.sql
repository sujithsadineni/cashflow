-- ===========================================================
-- cashflow :: migration 057 — terms-change notices (D350)
--
-- Statement-extraction step 4's last part. A card statement sometimes
-- carries a notice that the account's terms change on a date (a fee
-- going up, the penalty APR reworded), sometimes with a date by which the
-- change can be rejected. Kept as printed: its effective date, the
-- reject-by date when there is one, and its first few points. Shown as an
-- alert until a month after it takes effect.
-- ===========================================================

BEGIN;

ALTER TABLE statement ADD COLUMN terms_notice JSONB;

ALTER TABLE alert DROP CONSTRAINT alert_type_check;
ALTER TABLE alert ADD CONSTRAINT alert_type_check CHECK (type IN (
  'OVERDUE_STATEMENT', 'MISSED_RECURRING', 'NEW_RECURRING', 'PENDING_REVIEW', 'CARD_PAYMENT_DUE', 'CARD_TERMS_CHANGED', 'TERMS_NOTICE'));

COMMIT;
