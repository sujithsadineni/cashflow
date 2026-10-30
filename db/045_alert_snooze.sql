-- ===========================================================
-- cashflow :: migration 045 — snoozed, dismissed and paid alerts (D318)
--
-- An alert the household has answered: snoozed for a few days, dismissed
-- ("I know, it's cancelled"), or a card bill marked paid before its statement
-- shows the payment. Keyed like the Alerts page's items ('pay:9', 'stmt:12',
-- 'bill:25', 'payments'), with `ref` naming which occurrence it answers (the
-- bill's due date, the statement's expected date) so next month's bill is a
-- new alert, not a hidden one. `until` null means for good (dismiss, paid).
-- Nothing is computed from this but what to hide; deleting a row is Undo.
-- ===========================================================

BEGIN;

CREATE TABLE alert_snooze (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  ref         TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL CHECK (kind IN ('snooze', 'dismiss', 'paid')),
  until       DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, ref)
);

COMMIT;
