-- ===========================================================
-- cashflow :: migration 061 — what a bank statement says its money earned (D355)
--
-- Statement-extraction step 6. Robinhood Savings and SoFi print the yield
-- (APY earned), the interest paid this period and this year, and Robinhood
-- the tax withheld. Kept as printed, for the back of a bank account on Cards
-- beside its balance (D180). No projection of what it will earn (out of scope).
-- ===========================================================

BEGIN;

ALTER TABLE statement ADD COLUMN savings JSONB;

COMMIT;
