-- ===========================================================
-- cashflow :: migration 048 — rewards taken as gift cards (D330)
--
-- Points and rewards balances (Zolve's ZPoints, Bilt points, Samsung's
-- cash rewards) are often worth more as a gift card than as a statement
-- credit, and a gift card leaves no line on any statement, so the app
-- never saw that money come back. The owner records each one by hand:
-- the card, the day, the brand, what the gift card is worth, and what
-- it cost in rewards (dollars or points). Cashback counts the gift
-- card's value on that day (money/cashback.js).
--
-- Never deleted: a mistake is voided (voided_at) and audited, so the
-- history of what was entered stays.
-- ===========================================================

BEGIN;

CREATE TABLE reward_redemption (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id         INTEGER NOT NULL REFERENCES account(id),
  redeemed_on        DATE NOT NULL,
  brand              TEXT NOT NULL CHECK (length(brand) BETWEEN 1 AND 60),
  value_cents        INTEGER NOT NULL CHECK (value_cents > 0),
  -- What it cost: rewards in dollars, or points. Either, both or neither.
  rewards_used_cents INTEGER CHECK (rewards_used_cents > 0),
  points_used        INTEGER CHECK (points_used > 0),
  note               TEXT CHECK (length(note) <= 200),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at          TIMESTAMPTZ
);

CREATE INDEX idx_reward_redemption_account ON reward_redemption (account_id, redeemed_on);

COMMIT;
