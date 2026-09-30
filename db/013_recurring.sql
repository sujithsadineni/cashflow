-- ===========================================================
-- cashflow :: migration 013 — recurring expenses
--
-- Detection proposes, you confirm — same principle as staged_transaction
-- for imports. A recurring isn't a one-time detection result, it's a
-- persistent rule: a stable substring of `transaction.merchant`, an
-- amount range, and (for monthly bills) the days of the month it
-- tends to land on. Saved rules keep matching future transactions
-- automatically after each import is approved, without re-running
-- detection.
--
-- match_name_contains is checked against transaction.merchant, not
-- the raw statement description — merchant is already cleaned by the
-- LLM parse step (parse/categorize.js, parse/pdf.js), so there's no
-- need for a second normalizer here.
--
-- No hard delete, same rule as everywhere else in this database — a
-- cancelled subscription's history is still real spending history.
-- Ending one sets status = 'ENDED'.
-- ===========================================================

BEGIN;

CREATE TABLE recurring_series (
  id                      SERIAL PRIMARY KEY,

  name                    TEXT NOT NULL,             -- display name, e.g. 'Netflix'
  glyph                   TEXT NOT NULL,              -- a single emoji/symbol, user-chosen
  category_id             INTEGER REFERENCES category(id),
  account_id              INTEGER REFERENCES account(id),  -- NULL = matches any account
  person_id               INTEGER REFERENCES person(id),   -- NULL = matches either person

  -- the matching rule
  match_name_contains     TEXT NOT NULL,             -- stable substring of transaction.merchant
  match_amount_min_cents  INTEGER,
  match_amount_max_cents  INTEGER,
  match_days_of_month     INTEGER[],                 -- e.g. {23,24,25}, set for MONTHLY only

  -- the schedule
  cadence                 TEXT NOT NULL
                          CHECK (cadence IN ('WEEKLY','BIWEEKLY','MONTHLY','QUARTERLY','ANNUAL')),
  cadence_interval        INTEGER NOT NULL DEFAULT 1,  -- 1 = every cadence, 2 = every other
  expected_amount_cents   INTEGER NOT NULL,
  amount_varies           BOOLEAN NOT NULL DEFAULT false,  -- true for utilities, false for subscriptions

  status                  TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','PAUSED','ENDED')),
  next_expected_date      DATE,
  confidence              TEXT NOT NULL CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  created_from            TEXT NOT NULL CHECK (created_from IN ('DETECTED','MANUAL')),

  first_seen_date         DATE,
  last_seen_date          DATE,
  occurrence_count        INTEGER NOT NULL DEFAULT 0,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_status ON recurring_series(status);

ALTER TABLE transaction
  ADD COLUMN recurring_series_id INTEGER REFERENCES recurring_series(id);

CREATE INDEX idx_txn_recurring ON transaction(recurring_series_id)
  WHERE recurring_series_id IS NOT NULL;

COMMIT;
