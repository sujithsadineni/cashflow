-- ===========================================================
-- cashflow :: migration 039 — contact aliases and distinct pairs (D290)
--
-- A Zelle review files a name under the contact with that exact name
-- (D95), so every spelling a bank prints ("Quinn", "Quin",
-- "Quinn Parker") became its own contact. Merging two contacts keeps
-- the merged-away spellings here, lowercased, so a later Zelle with one
-- of them lands on the right contact instead of making a new one.
--
-- contact_distinct holds the pairs the household said are different
-- people ("Rowan Hayes" and "Rowan Lee"), so the duplicate list stops
-- suggesting them. low_id < high_id: one row per pair, either way round.
-- ===========================================================

BEGIN;

ALTER TABLE contact ADD COLUMN aliases TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE contact_distinct (
  low_id     INTEGER NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  high_id    INTEGER NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (low_id, high_id),
  CHECK (low_id < high_id)
);

COMMIT;
