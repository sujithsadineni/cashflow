-- ===========================================================
-- cashflow :: migration 008 — loan monthly payment, savings txn_type
--
-- Two independent additions bundled into one migration since they
-- were requested together:
--
-- 1. `loan.monthly_payment_cents` — with this, term_months and
--    start_date, the app can compute an estimated remaining balance
--    (payment x months left) instead of trusting a manually-entered
--    number that goes stale the moment you forget to update it.
--    Still nullable: a loan without a fixed payment (or without a
--    known start date yet) just falls back to the manual balance.
--
-- 2. `txn_type` gains 'savings' — for a transfer that leaves a
--    tracked account for a destination this app has no account for
--    (a Robinhood transfer, an Apple Card/Goldman Sachs savings
--    account), but IS, as a real fact the household confirmed,
--    money being set aside. D28 deliberately never guesses this from
--    a description; this is the opposite of a guess — an explicit
--    per-transaction tag, applied the same way category/merchant/type
--    already are, only once a human has actually confirmed it.
-- ===========================================================

BEGIN;

ALTER TABLE loan
  ADD COLUMN monthly_payment_cents INTEGER CHECK (monthly_payment_cents IS NULL OR monthly_payment_cents > 0);

ALTER TABLE transaction DROP CONSTRAINT transaction_txn_type_check;
ALTER TABLE transaction ADD CONSTRAINT transaction_txn_type_check
  CHECK (txn_type IN ('purchase','refund','payment','transfer','deposit','fee','interest','cashback','savings'));

ALTER TABLE staged_transaction DROP CONSTRAINT staged_transaction_txn_type_check;
ALTER TABLE staged_transaction ADD CONSTRAINT staged_transaction_txn_type_check
  CHECK (txn_type IN ('purchase','refund','payment','transfer','deposit','fee','interest','cashback','savings'));

COMMIT;
