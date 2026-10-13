-- ===========================================================
-- cashflow :: migration 032 — how a card payment was paid
-- ===========================================================
--
-- D200: not every card payment leaves one of the household's banks as
-- one row of the same amount (D199). The real cases found:
--   person     someone else paid the card and was paid back by Zelle
--              (Alex paid $3,000; $2,500 + $500 Zelled back)
--   cash       paid in cash at a bank ATM ("ATM PAYMENT DURHAM NC")
--   statement  the card's own line names the source ("Online payment
--              from CHK 9657") but that bank statement isn't uploaded:
--              named, not yet verified
--   outside    marked by hand: an account not in the app
--   bank       a bank row (or two that add up) — D199's case
--
-- payment_match_part holds every row a match uses: one or two bank rows,
-- or the Zelles. Its UNIQUE transaction_id means no row backs two
-- payments. bank_transaction_id stays as the first bank row so the
-- simple one-row reads keep working.

ALTER TABLE payment_match ADD COLUMN via TEXT NOT NULL DEFAULT 'bank'
  CHECK (via IN ('bank', 'person', 'cash', 'statement', 'outside'));

ALTER TABLE payment_match DROP CONSTRAINT payment_match_status_check;
ALTER TABLE payment_match ADD CONSTRAINT payment_match_status_check
  CHECK (status IN ('verified', 'named', 'unverified'));

-- D199's two pairing rules assumed every verified match was a bank row.
ALTER TABLE payment_match DROP CONSTRAINT payment_match_check;
ALTER TABLE payment_match DROP CONSTRAINT payment_match_check1;
ALTER TABLE payment_match ADD CONSTRAINT payment_match_bank_row_check
  CHECK ((via = 'bank' AND status = 'verified') = (bank_transaction_id IS NOT NULL));
ALTER TABLE payment_match ADD CONSTRAINT payment_match_verified_reason_check
  CHECK (status <> 'verified' OR reason IS NULL);

CREATE TABLE payment_match_part (
  match_id        INTEGER NOT NULL REFERENCES payment_match(id) ON DELETE CASCADE,
  transaction_id  INTEGER NOT NULL UNIQUE REFERENCES transaction(id),
  PRIMARY KEY (match_id, transaction_id)
);

INSERT INTO payment_match_part (match_id, transaction_id)
SELECT id, bank_transaction_id FROM payment_match WHERE bank_transaction_id IS NOT NULL;
