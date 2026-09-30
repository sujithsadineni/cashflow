-- ===========================================================
-- cashflow :: migration 010 — loan type
--
-- A loan's TYPE (car, home, credit card, other) is independent of
-- how its balance is known (D45's statement/formula/manual sources)
-- and independent of which per-loan detail view applies (a fixed
-- term shows a paid/remaining month grid; anything without one — a
-- 0% balance-transfer card, most likely — shows just a promo-end
-- date and a balance). This column exists purely so the Overview
-- Loans card and the loans list can show the right icon per loan,
-- nothing computational depends on it.
-- ===========================================================

BEGIN;

ALTER TABLE loan
  ADD COLUMN loan_type TEXT NOT NULL DEFAULT 'other'
    CHECK (loan_type IN ('car', 'home', 'credit_card', 'other'));

COMMIT;
