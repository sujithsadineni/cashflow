-- ===========================================================
-- cashflow :: migration 036 — "No statement this month"
-- ===========================================================
--
-- D268: a card issuer sends no statement for a cycle with no activity
-- and a $0 balance. statement-gaps.js proves most such cycles quiet from
-- the statements on both sides; the newest gap has no statement after
-- it, so the household is asked once and the answer is kept here.
--
-- A cycle is named by its card and the day it would have closed. The
-- answer never hides evidence: if a later upload shows activity in that
-- cycle, it's reported missing again ("You said … but"). Removing the
-- row is the undo.

CREATE TABLE statement_gap_answer (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account(id),
  cycle_end   DATE NOT NULL,
  answer      TEXT NOT NULL DEFAULT 'no_statement' CHECK (answer IN ('no_statement')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, cycle_end)
);
