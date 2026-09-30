-- ===========================================================
-- cashflow :: migration 012 — drop the balance-transfer allocation column
--
-- Migration 011 added `original_amount_cents` to support splitting
-- one card into multiple independently-tracked balance-transfer
-- loans, each closing on its own via a custom payment-allocation
-- algorithm. Reconsidered after checking how real card issuers and
-- mainstream personal finance apps (YNAB, Monarch, Copilot) actually
-- handle this: none of them track sub-balances within a single card,
-- and even the issuer's own statement never prints a "remaining
-- principal for this specific transfer" figure to defer to — the
-- allocation math was computing a number that doesn't exist anywhere
-- in reality, the opposite of this app's own rule for loans ("read
-- the number off reality, don't compute it").
--
-- Reverted to one loan per card, balance read straight off the
-- linked account's real statement (Tier 1, unchanged, already
-- correct) — same as every other linked-account loan. `loan_type`
-- keeps 'balance_transfer' as a plain cosmetic option (icon only,
-- per migration 010's own original intent); only the column that
-- existed purely to feed the removed allocation logic goes.
-- ===========================================================

BEGIN;

ALTER TABLE loan DROP COLUMN original_amount_cents;

COMMIT;
