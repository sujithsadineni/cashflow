-- ===========================================================
-- cashflow :: migration 052 — remembered PDF passwords (D336)
--
-- The owner's request: on this, their own computer, a password typed to
-- open a statement is kept, so the next statement from that issuer opens
-- by itself and its real pages can be shown. Encrypted (AES-256-GCM) with
-- a key kept in data/ (outside git), never in a log or an audit entry.
-- `label` is who or what it's for (a person, an issuer): optional.
-- ===========================================================

BEGIN;

CREATE TABLE pdf_password (
  id           SERIAL PRIMARY KEY,
  label        TEXT,
  secret       TEXT NOT NULL,          -- base64 iv.tag.ciphertext
  fingerprint  TEXT NOT NULL UNIQUE,   -- HMAC of the password, to keep one row per password
  uses         INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
