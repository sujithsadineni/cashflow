-- ===========================================================
-- cashflow :: migration 014 — Zelle review
--
-- Zelle transactions arrive parsed as txn_type='transfer' — correct
-- for a transfer between the household's own accounts, wrong for a
-- real payment to or from someone else. Both look identical to the
-- parser; only a human reviewing each one can tell them apart. Same
-- discipline as staged_transaction for imports: nothing gets counted
-- as real income or spend until it's been looked at.
--
-- zelle_type drives the actual accounting effect, applied by setting
-- txn_type when a row is reviewed (see api/src/routes/zelle.js):
--   INTERNAL -> txn_type stays 'transfer'  (already excluded from both)
--   SENT     -> txn_type becomes 'purchase' (counts as spend)
--   RECEIVED -> txn_type becomes 'deposit'  (counts as income)
-- No change needed to the Income/Spend SQL in summary.js — it already
-- keys off txn_type alone, and Savings is derived from those two, so
-- it updates automatically too.
--
-- No separate "needs review" flag: that's just
-- `description ILIKE '%zelle%' AND zelle_type IS NULL`, cheap at this
-- data volume and can't drift out of sync with the description.
-- ===========================================================

BEGIN;

ALTER TABLE transaction
  ADD COLUMN zelle_type   TEXT CHECK (zelle_type IN ('INTERNAL','SENT','RECEIVED')),
  ADD COLUMN zelle_person TEXT;

COMMIT;
