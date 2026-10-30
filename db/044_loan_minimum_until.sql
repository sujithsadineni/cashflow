-- ===========================================================
-- cashflow :: migration 044 — a balance transfer's payoff plan (D309)
--
-- The owner pays a 0% balance transfer back on purpose in two phases: the
-- statement minimum for most of the promo, then the rest in even payments
-- over its last months (it cleared both 2024-25 BofA promos that way, D308).
-- An even-split pace calls that "behind" for months. minimum_until is the
-- last month of the minimum phase (stored as its first day); null keeps the
-- even split.
-- ===========================================================

BEGIN;

ALTER TABLE loan ADD COLUMN minimum_until DATE;

COMMIT;
