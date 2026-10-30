-- ===========================================================
-- cashflow :: migration 053 — shared cards: members and who spent it (D344)
--
-- Four cards are shared: Apple Card has a co-owner, Blue Cash Preferred
-- and Frontier an additional card member with their own card ending, and
-- the Samsung Galaxy Card a member just added. Their statements print each
-- person's rows in their own section, but every row was counted as the
-- account owner's, so "by person" was wrong by everything the second person
-- spent.
--
-- `account_member`: who else is on a card, how the statement prints them
-- (`printed_name`, matched exactly, since a statement's name needn't be the
-- one in People), and the card ending when they have their own. A new name
-- or ending on a statement proposes a member; nothing adds one by itself.
--
-- On rows: `spender_name` and `card_ending` as printed (staged and saved),
-- and `spender_person_id`, the person it resolved to. NULL means the
-- account's own person, so every row that isn't on a shared card is
-- unchanged.
-- ===========================================================

BEGIN;

CREATE TABLE account_member (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES account(id),
  person_id     INTEGER NOT NULL REFERENCES person(id),
  role          TEXT NOT NULL CHECK (role IN ('owner', 'co_owner', 'additional')),
  printed_name  TEXT,
  card_ending   TEXT CHECK (card_ending ~ '^\d{4}$'),
  since         DATE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, person_id)
);

ALTER TABLE staged_transaction
  ADD COLUMN spender_name TEXT,
  ADD COLUMN card_ending  TEXT CHECK (card_ending ~ '^\d{4}$');

ALTER TABLE transaction
  ADD COLUMN spender_name      TEXT,
  ADD COLUMN card_ending       TEXT CHECK (card_ending ~ '^\d{4}$'),
  ADD COLUMN spender_person_id INTEGER REFERENCES person(id);

CREATE INDEX idx_txn_spender ON transaction (spender_person_id) WHERE spender_person_id IS NOT NULL;

COMMIT;
