-- ===========================================================
-- cashflow :: migration 022 — persisted alert history
-- ===========================================================
--
-- GET /api/alerts (routes/alerts.js) already computes "what's true
-- right now" for toasts, but a toast is fire-and-forget — refresh the
-- page and it's gone, so there's no way to browse past months or see
-- that something WAS wrong and got fixed. This table is that record.
--
-- Reconciliation only ever writes for the CURRENT month (see
-- reconcileMonth in routes/alerts.js) — every other month is pure
-- history of what got written while it was current. Re-deriving
-- whether March's statement was overdue, after the fact, would mean
-- fabricating a fact nobody actually checked at the time; this table
-- only ever records what was actually true when it was actually
-- checked.
--
-- Never hard-deleted, same rule as everywhere else in this database.
-- Clearing a condition sets resolved_at; the row stays as the record
-- that it was once a real, flagged problem.

BEGIN;

CREATE TABLE alert (
  id                SERIAL PRIMARY KEY,

  type              TEXT NOT NULL
                    CHECK (type IN ('OVERDUE_STATEMENT', 'MISSED_RECURRING', 'NEW_RECURRING', 'PENDING_REVIEW')),
  natural_key       TEXT NOT NULL,   -- stable identity within (type, month), e.g. 'account:5'
  month             TEXT NOT NULL,   -- 'YYYY-MM' this alert belongs to

  title             TEXT NOT NULL,
  detail            JSONB NOT NULL DEFAULT '{}',

  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (type, natural_key, month)
);

CREATE INDEX idx_alert_month ON alert(month);
CREATE INDEX idx_alert_unresolved ON alert(type, month) WHERE resolved_at IS NULL;

COMMIT;
