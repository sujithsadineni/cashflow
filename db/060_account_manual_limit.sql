-- ===========================================================
-- cashflow :: migration 060 — a credit limit the household sets (D354)
--
-- Apple prints no limit, and Zolve's 2026 statements stopped printing it,
-- so those cards had no utilisation. The owner asked to enter a limit by
-- hand. It is used only where no statement printed one (a printed limit,
-- then the last printed one, win), and is always shown as set by them.
-- ===========================================================

BEGIN;

ALTER TABLE account ADD COLUMN credit_limit_manual_cents BIGINT CHECK (credit_limit_manual_cents > 0);

COMMIT;
