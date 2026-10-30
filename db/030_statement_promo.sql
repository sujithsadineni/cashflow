-- ===========================================================
-- cashflow :: migration 030 — promotional rates, read off statements
-- ===========================================================
--
-- D192: a balance transfer's promo end date was typed by hand into
-- loan.deadline_date. The issuer already prints it every month, in the
-- statement's interest-charge table ("Balance Transfer/Check Promotion
-- 04/05/27 ... 0.00%", "Promotional APR 0.00% DD LR25-05262 10/13/2027"),
-- so it's read like cashback: copied, never computed.
--
-- One row per promo line per statement. Kept per statement, not per
-- account, so a later statement that moves the date (BofA: "this date
-- is based on a future statement closing date") is visible as a change.
--
-- balance_subject_cents is the issuer's "Balance Subject to Interest
-- Rate": an AVERAGE daily balance for the cycle, not what's left of the
-- transfer. Stored because it's printed, labelled as what it is in the
-- UI, never used as a remaining balance.
--
-- APRs are basis points (29.74% = 2974): integers, like money.

CREATE TABLE statement_promo (
  id                    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  statement_id          INTEGER NOT NULL REFERENCES statement(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('balance_transfer', 'cash_advance', 'purchase', 'other')),
  label                 TEXT NOT NULL,
  offer_id              TEXT,
  apr_bps               INTEGER NOT NULL CHECK (apr_bps >= 0),
  standard_apr_bps      INTEGER CHECK (standard_apr_bps IS NULL OR standard_apr_bps >= 0),
  end_date              DATE NOT NULL,
  balance_subject_cents INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_statement_promo_statement ON statement_promo (statement_id);
