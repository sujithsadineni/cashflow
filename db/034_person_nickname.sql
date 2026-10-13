-- ===========================================================
-- cashflow :: migration 034 — a nickname per person (D237)
--
-- Tight places (the Transactions table's Person column) show a person
-- by nickname, or by first name when there's none, instead of a full
-- name cut off mid-word. Household data, like the avatar (025), so it
-- lives on the person, set in Settings → People. Nullable: no nickname
-- means the first name.
-- ===========================================================

BEGIN;

ALTER TABLE person
  ADD COLUMN nickname TEXT CHECK (nickname IS NULL OR char_length(nickname) <= 40);

COMMIT;
