-- ===========================================================
-- cashflow :: migration 005 — account appearance
--
-- The new card-carousel view renders one tile per account. Each
-- needs a color (a per-card accent, not a third app-wide accent
-- color — spend/earn stay the only meaning-carrying colors) and,
-- optionally, a custom image that overrides the color.
-- ===========================================================

BEGIN;

ALTER TABLE account
  ADD COLUMN color TEXT,          -- hex, e.g. '#2F6B4F' - card tile background
  ADD COLUMN image_path TEXT;     -- optional custom card image, overrides color

COMMIT;
