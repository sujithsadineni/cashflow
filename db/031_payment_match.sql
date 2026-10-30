-- ===========================================================
-- cashflow :: migration 031 — where a card payment came from
-- ===========================================================
--
-- D199: a card statement's payment line says "MOBILE PAYMENT - THANK
-- YOU", never which bank paid it. The bank's own statement has the other
-- half: the same amount going out a day or few later. This links the
-- two, so the card row can say "Payment from SoFi" and be verified.
--
-- A link table, not a column or a merchant rename:
--   - the household's own merchant names stay untouched (and merchant
--     learning never learns a made-up name)
--   - one link serves both sides: the bank row can say "Payment to Blue
--     Cash Preferred" from the same row
--   - bank_transaction_id is UNIQUE, so one withdrawal can never verify
--     two card payments
--
-- 'unverified' rows are kept too, with why: the likely bank's statement
-- isn't uploaded yet (statement_missing), every bank is covered and none
-- has it (no_match), or two bank rows fit equally (ambiguous). A re-run
-- after each import replaces 'auto' rows; a 'manual' link is never
-- touched by a re-run.

CREATE TABLE payment_match (
  id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_transaction_id  INTEGER NOT NULL UNIQUE REFERENCES transaction(id),
  bank_transaction_id  INTEGER UNIQUE REFERENCES transaction(id),
  status               TEXT NOT NULL CHECK (status IN ('verified', 'unverified')),
  reason               TEXT CHECK (reason IN ('statement_missing', 'no_match', 'ambiguous')),
  source               TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  -- likely_account_id, covered_until, candidate ids: what the reason sentence needs
  detail               JSONB NOT NULL DEFAULT '{}',
  checked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'verified') = (bank_transaction_id IS NOT NULL)),
  CHECK ((status = 'verified') = (reason IS NULL))
);

CREATE INDEX idx_payment_match_status ON payment_match (status);
