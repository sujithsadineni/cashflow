-- ===========================================================
-- cashflow :: migration 025 — a chosen avatar per person
--
-- Settings → People lets each person pick a family icon (an emoji:
-- 👨 👩 👧 👴 🐶 …) instead of only coloured initials (D144). It's
-- household data — both people see the same avatar for the same
-- person — so it lives here, not in a browser's localStorage the way
-- the per-person Design choice does. Nullable: no avatar means the
-- initials badge, exactly as before. The length cap is generous for
-- multi-codepoint emoji (skin tones, ZWJ sequences) and nothing more.
-- ===========================================================

BEGIN;

ALTER TABLE person
  ADD COLUMN avatar TEXT CHECK (avatar IS NULL OR char_length(avatar) <= 16);

COMMIT;
