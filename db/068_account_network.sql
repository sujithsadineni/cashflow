-- ===========================================================
-- cashflow :: migration 068 — a card's payment network, set by hand (D416)
--
-- A card's face shows its network's mark (Visa, Mastercard, American
-- Express, Discover). Known products carry theirs (card-products.js);
-- any other card had none, and a wrong one couldn't be corrected.
-- NULL means automatic: the product's network, when the app knows it.
-- ===========================================================

BEGIN;

ALTER TABLE account ADD COLUMN network TEXT
  CHECK (network IN ('VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'));

COMMIT;
