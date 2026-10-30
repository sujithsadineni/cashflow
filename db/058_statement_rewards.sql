-- ===========================================================
-- cashflow :: migration 058 — rewards as printed (D351)
--
-- Statement-extraction step 3. What each card statement says it earned,
-- in its own parts and units: Bank of America's base, category bonus,
-- relationship bonus, redeemed and available cash back; Frontier's miles
-- sent to the airline. Kept as printed (CLAUDE.md: cashback is read off the
-- statement, never calculated); cashback_earned_cents stays the one dollar
-- figure the app sums. Miles are never dollars.
-- ===========================================================

BEGIN;

ALTER TABLE statement ADD COLUMN rewards JSONB;

COMMIT;
