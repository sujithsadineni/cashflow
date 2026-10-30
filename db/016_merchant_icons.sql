-- ===========================================================
-- cashflow :: migration 016 — merchant icons
--
-- A real audit of the dev database found 201 of 235 distinct
-- merchants render with no icon at all — a plain colored-initial
-- fallback. merchant-logos.js's hand-curated domain map narrows that
-- gap but can't close it: a real local restaurant or small shop has
-- no scrapable favicon to guess, and even a known chain's favicon can
-- silently fail in a browser running an ad blocker (Bank of America
-- was reported broken; its favicon URL resolves fine outside the
-- browser, so this is a real, structural reason no static map alone
-- can fix it).
--
-- merchant_icon is a lookup table keyed by merchant name, not a new
-- foreign key on transaction — unlike zelle_person before contact
-- (015_contacts.sql), transaction.merchant is already a clean, stable
-- string produced by statement parsing, so there's no entity to model
-- here, just an override to record. Render priority: custom photo →
-- custom emoji → auto-detected domain logo → colored initial. Emoji
-- and photo are mutually exclusive from the user's side (the API
-- clears one when the other is set), so there's never an ambiguous
-- "which one wins" case.
-- ===========================================================

BEGIN;

CREATE TABLE merchant_icon (
  id          SERIAL PRIMARY KEY,
  merchant    TEXT NOT NULL UNIQUE,
  emoji       TEXT,
  image_path  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
