-- ===========================================================
-- cashflow :: migration 038 — which card printed each statement
-- ===========================================================
--
-- D275. One account can go through several cards: Amex reissues the
-- number when a card expires or is lost, and an upgrade (Blue Cash
-- Everyday → Blue Cash Preferred, Feb 2024) keeps the account but
-- changes the product and the number. The account's history is read
-- off its statements instead of kept beside them: each statement
-- records the last 4 and the product it was printed with. The
-- account's own mask stays its current card.
--
-- Last 4 only, like account.mask: never a full card number.

ALTER TABLE statement
  ADD COLUMN card_mask    CHAR(4) CHECK (card_mask ~ '^[0-9]{4}$'),
  ADD COLUMN product_name TEXT;

CREATE INDEX statement_card_mask_idx ON statement (card_mask);
