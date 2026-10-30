-- ===========================================================
-- cashflow :: migration 047 — a card's flat cash back rate (D330)
--
-- Cashback is read off the statement (CLAUDE.md), but some cards print
-- none at all: Robinhood's Gold Card pays a flat 3% on purchases (and
-- takes 3% back on a refund) and its statement says nothing about it.
-- For such a card the owner sets the rate here, in basis points (300 =
-- 3%), and the app works the cash back out of the statement's own rows
-- (api/src/money/flat-cashback.js). NULL, every other card: read only.
-- ===========================================================

BEGIN;

ALTER TABLE account
  ADD COLUMN cashback_rate_bps SMALLINT
    CHECK (cashback_rate_bps BETWEEN 1 AND 2000);

COMMIT;
