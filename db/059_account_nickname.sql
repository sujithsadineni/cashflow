-- ===========================================================
-- cashflow :: migration 059 — a short nickname per account (D353)
--
-- The owner's request: "Customized Cash Rewards ··5108" and "Frontier
-- Airlines World Mastercard" don't fit the Transactions table's Account
-- column. A short name the household picks ("BofA Custom", "Frontier"),
-- shown wherever space is tight; the full name stays everywhere else.
-- NULL means no nickname: the full name is shown.
-- ===========================================================

BEGIN;

ALTER TABLE account ADD COLUMN nickname TEXT CHECK (char_length(nickname) BETWEEN 1 AND 24);

COMMIT;
