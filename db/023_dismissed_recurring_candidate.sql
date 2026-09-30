-- ===========================================================
-- cashflow :: migration 023 — dismissing a recurring candidate
-- ===========================================================
--
-- Detection (recurring.js) has always had exactly one way to stop
-- proposing a merchant: confirm it into a real recurring_series.
-- There was no "no, don't ask again" — the Recurring page's own
-- "Dismiss" button only ever filtered the in-memory React list, so a
-- dismissed candidate reappeared the moment you refreshed or re-ran
-- detection. This table is what actually makes a dismissal stick.
--
-- Keyed on match_name_contains, the same stable identity used
-- everywhere else a candidate needs one (recurring_series.
-- match_name_contains, the `alert` table's own natural_key for
-- NEW_RECURRING rows) — not a foreign key to anything, because a
-- mere candidate has no row of its own to point at.

CREATE TABLE dismissed_recurring_candidate (
  id                    SERIAL PRIMARY KEY,
  match_name_contains   TEXT NOT NULL UNIQUE,
  dismissed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
