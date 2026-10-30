-- ===========================================================
-- cashflow :: migration 049 — the day a printed rewards balance stood
--
-- Amex prints Reward Dollars "as of" the previous statement's closing
-- date, not its own: the September statement shows the balance on
-- Aug 25. A payout posted after that day ("YOUR CASH REWARD/REFUND IS")
-- is already out of the balance, so waiting has to subtract it
-- (money/cashback.js). The date is read off the page, not assumed from
-- the previous statement, which may be missing. NULL: the balance
-- stands on the statement's own closing date (BofA, Barclays).
-- ===========================================================

BEGIN;

ALTER TABLE statement ADD COLUMN cashback_balance_as_of DATE;

COMMIT;
