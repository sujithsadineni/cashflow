-- ===========================================================
-- cashflow :: migration 024 — app_setting
-- ===========================================================
--
-- A small generic key/value store for shared household preferences
-- that don't belong to any one entity — starting with which small
-- summary cards show on Overview, but built generic on purpose: the
-- next simple on/off or small-JSON preference (and there will be one)
-- gets a row here instead of its own bespoke table and route pair.
--
-- No `person_id` — this app has no login (D105), a preference here is
-- shared by the household the same way every other setting already
-- is. JSONB, not a typed column per setting, because the whole point
-- is not needing a migration for the next one.

CREATE TABLE app_setting (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
