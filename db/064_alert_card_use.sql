-- ===========================================================
-- cashflow :: migration 064 — card high use and spending jumps as alerts (D361)
--
-- The owner's ask after a Robinhood Gold bill went unmentioned: a card at
-- 30% or more of its limit on its newest statement, and a card whose new
-- charges are twice its usual, kept in the alert history like the rest.
-- ===========================================================

BEGIN;

ALTER TABLE alert DROP CONSTRAINT alert_type_check;
ALTER TABLE alert ADD CONSTRAINT alert_type_check CHECK (type IN (
  'OVERDUE_STATEMENT', 'MISSED_RECURRING', 'NEW_RECURRING', 'PENDING_REVIEW', 'CARD_PAYMENT_DUE', 'CARD_TERMS_CHANGED', 'TERMS_NOTICE',
  'CARD_HIGH_USE', 'CARD_SPEND_JUMP'));

COMMIT;
