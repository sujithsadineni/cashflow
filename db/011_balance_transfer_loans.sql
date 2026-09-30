-- ===========================================================
-- cashflow :: migration 011 — balance-transfer loans
--
-- The household's first real balance-transfer card carries more
-- than one draw at 0% APR (a large transfer, then a separate
-- smaller transfer the next month) on the SAME physical card/account.
-- Tier 1 of EFFECTIVE_BALANCE_SQL (routes/loans.js) reads a linked
-- account's own statement balance — exactly right for a loan that
-- occupies a card by itself, but wrong here: two loans linking the
-- same account would both show the card's FULL combined balance,
-- double-counting it in the household total. Excluded below via
-- HAS_LINKED_STATEMENT_SQL; a new JS-computed allocation (splitting
-- the account's real payments across its balance-transfer loans,
-- smallest-original-amount first) takes over for this loan_type
-- instead. See routes/loans.js's computeBalanceTransferAllocations.
--
-- original_amount_cents is the one new fact that allocation needs
-- and nothing else on this table provides: the amount actually
-- transferred, fixed at creation, distinct from current_balance_cents
-- (which stays as this loan_type's manual-entry fallback, per the
-- three-tier system, used only until a real payment exists to
-- allocate against).
-- ===========================================================

BEGIN;

ALTER TABLE loan DROP CONSTRAINT loan_loan_type_check;
ALTER TABLE loan ADD CONSTRAINT loan_loan_type_check
  CHECK (loan_type IN ('car', 'home', 'credit_card', 'balance_transfer', 'other'));

ALTER TABLE loan ADD COLUMN original_amount_cents INTEGER
  CHECK (original_amount_cents IS NULL OR original_amount_cents > 0);

COMMIT;
