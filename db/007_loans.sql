-- ===========================================================
-- cashflow :: migration 007 — loans
--
-- Debt gets its own table rather than columns bolted onto `account`,
-- because a loan doesn't always correspond to something with
-- statements: the Wells Fargo car loan has no account of its own in
-- this app (it's paid via recurring debits on the Chase checking
-- account), while a 0% APR balance-transfer card IS a real account
-- with its own statements. `linked_account_id` is the optional bridge
-- for the latter case; everything else is manual entry for now,
-- updated by hand as balances change — no statement parsing here yet.
-- ===========================================================

BEGIN;

CREATE TABLE loan (
  id                     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  name                   TEXT NOT NULL,                     -- "Wells Fargo Car Loan"
  lender                 TEXT,                              -- "Wells Fargo"

  -- Set only when this loan IS a tracked account elsewhere in the app
  -- (a balance-transfer card with its own statements). Null for a
  -- loan like the car loan that has no account of its own.
  linked_account_id      INTEGER REFERENCES account(id),

  term_months            INTEGER CHECK (term_months IS NULL OR term_months > 0),
  start_date             DATE,

  current_balance_cents  INTEGER NOT NULL CHECK (current_balance_cents >= 0),
  deadline_date          DATE,                              -- payoff target, or a 0% promo's end date

  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
