-- ===========================================================
-- cashflow :: migration 062 — installment plans on a card statement (D356)
--
-- Statement-extraction step 7. Amex Plan It turns a purchase into equal
-- monthly payments with a fixed fee; its statements print the plans'
-- balance, the payment due on them, and a line per plan (created, months,
-- remaining principal, monthly principal and fee). Kept as printed, so a plan
-- can be shown on the card and added to Loans by hand (loan tracking is in
-- scope: a balance and a deadline, no amortisation modelling).
-- ===========================================================

BEGIN;

ALTER TABLE statement ADD COLUMN plans JSONB;

COMMIT;
