-- ===========================================================
-- cashflow :: migration 054 — credit line and year-to-date box (D346)
--
-- Statement-extraction step 1. Every card statement prints its credit limit,
-- what's available and (most) a cash-advance limit; nearly every one prints
-- the year's fees and interest so far. None of it was kept. The limit gives
-- utilisation per card and for the household; the year-to-date box checks the
-- app's own fee and interest rows to the cent (this statement's year-to-date
-- less the previous one's is this period's fees and interest).
--
-- All nullable: NULL is "not printed", never zero. Apple prints no limit.
-- ===========================================================

BEGIN;

ALTER TABLE statement
  ADD COLUMN credit_limit_cents        BIGINT CHECK (credit_limit_cents >= 0),
  ADD COLUMN available_credit_cents    BIGINT,
  ADD COLUMN cash_advance_limit_cents  BIGINT CHECK (cash_advance_limit_cents >= 0),
  ADD COLUMN ytd_year                  INTEGER CHECK (ytd_year BETWEEN 2000 AND 2100),
  ADD COLUMN ytd_fees_cents            BIGINT CHECK (ytd_fees_cents >= 0),
  ADD COLUMN ytd_interest_cents        BIGINT CHECK (ytd_interest_cents >= 0);

COMMIT;
