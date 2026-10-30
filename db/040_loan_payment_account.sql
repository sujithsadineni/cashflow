-- ===========================================================
-- cashflow :: migration 040 — the account a loan is paid from (D299)
--
-- A scheduled loan's balance was estimated from time alone: payment ×
-- (term − months since start). A skipped payment changed nothing, so the
-- app could never notice one. It now counts the payments actually found
-- (routes/loans.js), and to tell a missed payment from one simply not on
-- file yet it needs to know where the payment should appear: this
-- account's records show how far the household's history reaches.
--
-- Nullable: a loan on a card (a balance transfer) is paid on that card,
-- and a hand-entered loan may not have one. Changeable, since the
-- household may move a loan to another account later; payments are
-- still found by lender on any account, so the old ones keep counting.
-- ===========================================================

BEGIN;

ALTER TABLE loan ADD COLUMN payment_account_id INTEGER REFERENCES account(id);

COMMIT;
