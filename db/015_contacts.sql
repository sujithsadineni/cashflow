-- ===========================================================
-- cashflow :: migration 015 — contacts
--
-- transaction.zelle_person is pure free text — no entity behind it
-- anywhere. "Alex" and "Alex Morgan" are two unrelated strings
-- as far as the app is concerned, which is why renaming one never
-- touched the other, and why there was nowhere to hang a photo or a
-- nickname off "this person" — there was no "this person," just
-- repeated text on each row.
--
-- contact is a real identity a transaction can point to. Renaming a
-- contact, or giving it a photo, is one write here — every surface
-- that joins through contact_id (the Zelle review page, Income's
-- Other Income cards, Transactions, Cards) picks it up immediately,
-- with no transaction rows touched.
-- ===========================================================

BEGIN;

CREATE TABLE contact (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  nickname    TEXT,
  image_path  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transaction ADD COLUMN contact_id INTEGER REFERENCES contact(id);
CREATE INDEX idx_txn_contact ON transaction(contact_id) WHERE contact_id IS NOT NULL;

-- Backfill: the household already reviewed every real Zelle row
-- (zelle_person is already set on each one). One contact per distinct
-- name, linked back — none of that review work is lost. Name variants
-- ("Alex" vs "Alex Morgan", "Casey" vs "Casey Diaz")
-- become separate contacts, same as they're separate strings today —
-- this migration doesn't guess at merging them, see docs/DECISIONS.md.
INSERT INTO contact (name)
SELECT DISTINCT zelle_person FROM transaction WHERE zelle_person IS NOT NULL;

UPDATE transaction t SET contact_id = c.id
  FROM contact c WHERE t.zelle_person = c.name;

COMMIT;
