-- ===========================================================
-- cashflow :: migration 041 — a merchant's website, for its logo (D300)
--
-- Logos come from a curated name → domain map (merchant-logos.js), which
-- only knows chains; 170 of 458 merchants show a plain glyph instead. A
-- local shop usually has a website, and its favicon is the logo it uses,
-- so the household can type it in: the avatar then reads that domain's
-- favicon the same way it reads a known chain's.
--
-- One source per merchant: choosing a photo, a website or an emoji clears
-- the other two (routes/merchant-icons.js), so what was chosen is what
-- shows. A hostname only ("bakery.com"), checked by the route and here.
-- ===========================================================

BEGIN;

ALTER TABLE merchant_icon ADD COLUMN domain TEXT
  CHECK (domain IS NULL OR domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$');

COMMIT;
