-- ===========================================================
-- cashflow :: migration 035 — the two halves of a transfer
-- ===========================================================
--
-- D265: money moved between the household's own accounts shows up
-- twice, once leaving one account and once arriving in another
-- ($6,000 out of Chase, $6,000 into Robinhood savings). Card payments
-- already have this link (payment_match, D199); a transfer had none,
-- so neither row could say where the money went or that the other
-- half was found. This links them, so each row can show a verified ✓
-- with "From Chase Total Checking" / "To Personal Savings".
--
-- Its own table rather than payment_match: that one is built around
-- a card payment and the words that go with it ("Paid by…"), and its
-- unverified/named states mean nothing for a transfer, which is either
-- found or not.
--
-- Both ids are UNIQUE: one half is never linked twice. A re-run after
-- each import replaces 'auto' rows; a 'manual' link is never touched.
-- ON DELETE CASCADE: deleting an import removes its links with its rows.

CREATE TABLE transfer_match (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  out_transaction_id  INTEGER NOT NULL UNIQUE REFERENCES transaction(id) ON DELETE CASCADE,
  in_transaction_id   INTEGER NOT NULL UNIQUE REFERENCES transaction(id) ON DELETE CASCADE,
  source              TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (out_transaction_id <> in_transaction_id)
);
