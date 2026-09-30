-- ===========================================================
-- cashflow :: migration 019 — category icon
--
-- Settings' Categories list gets a colorful icon per row, editable by
-- clicking it — same pattern as merchant_icon (016), just a plain
-- column here instead of a separate table, since category already IS
-- a real table with one row per category (merchant is free text with
-- no table of its own, which is why it needed one).
--
-- icon_key is nullable: NULL means "use the name-based default" (a
-- best-effort match, see web/src/category-icons.js), so every
-- existing category already looks reasonable with zero setup, and
-- only a deliberate override is ever stored.
-- ===========================================================

BEGIN;

ALTER TABLE category
  ADD COLUMN icon_key TEXT;

COMMIT;
