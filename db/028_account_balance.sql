-- ===========================================================
-- cashflow :: migration 028 — manually tracked balances
-- ===========================================================
--
-- D180: savings and investment accounts that never send a statement
-- the app reads (Apple Savings, Robinhood). Money moved into them
-- shows in the Savings breakdown (D179); this adds where it stands
-- now, typed in by hand like a loan's balance.
--
-- One balance per account per date. Entering the same date again
-- corrects that entry (audited). A newer date simply becomes the
-- latest, so nothing is ever deleted.

ALTER TABLE account DROP CONSTRAINT account_account_type_check;
ALTER TABLE account ADD CONSTRAINT account_account_type_check
  CHECK (account_type IN ('CREDIT_CARD', 'CHECKING', 'SAVINGS', 'INVESTMENT'));

CREATE TABLE account_balance (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES account(id),
  as_of          DATE NOT NULL,
  balance_cents  INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, as_of)
);
