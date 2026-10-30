-- ===========================================================
-- cashflow :: migration 069 — which nicknames the app gave (D416)
--
-- Accounts get a nickname automatically ("BCP", "Bilt Blue", "Zolve 5205"),
-- kept current as the card changes. One the person set is theirs and is
-- never replaced: true here means the app gave it.
-- ===========================================================

BEGIN;

ALTER TABLE account ADD COLUMN nickname_auto BOOLEAN NOT NULL DEFAULT false;

COMMIT;
