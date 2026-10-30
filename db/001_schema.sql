-- ===========================================================
-- cashflow :: database schema, version 1
--
-- Two people, their accounts, and every transaction from every
-- statement they've ever uploaded.
--
-- Rule for the whole database: money is stored as INTEGER CENTS.
-- $12.34 is stored as 1234. Never as 12.34.
-- Floating point numbers cannot represent 0.1 exactly, so adding
-- a few thousand of them drifts by cents. Integers never drift.
-- We divide by 100 only when displaying.
--
-- Sign convention: money OUT is negative, money IN is positive.
-- A $50 grocery purchase is -5000. A $200 refund is +20000.
-- ===========================================================

BEGIN;

-- -----------------------------------------------------------
-- PEOPLE
-- Just the two of you. A separate table (rather than a "whose"
-- text column on transactions) because later, when we add login,
-- each person gets a row here linked to their credentials.
-- -----------------------------------------------------------

CREATE TABLE person (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------
-- ACCOUNTS
-- One row per card or bank account. Owned by exactly one person.
-- We store the last 4 digits only, never a full card number --
-- there is no reason for the app to ever know it.
-- -----------------------------------------------------------

CREATE TABLE account (
  id            SERIAL PRIMARY KEY,
  person_id     INTEGER NOT NULL REFERENCES person(id),
  name          TEXT NOT NULL,              -- 'Bilt Blue'
  issuer        TEXT,                       -- 'Bilt'
  account_type  TEXT NOT NULL DEFAULT 'CREDIT_CARD'
                CHECK (account_type IN ('CREDIT_CARD','CHECKING','SAVINGS')),
  mask          TEXT,                       -- last 4 digits, e.g. '4417'
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_person ON account(person_id);

-- -----------------------------------------------------------
-- CATEGORIES
-- A lookup table rather than free text, so "Groceries" and
-- "groceries" and "Grocery" can't all coexist and split your
-- monthly totals three ways.
-- -----------------------------------------------------------

CREATE TABLE category (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 100
);

-- -----------------------------------------------------------
-- IMPORT BATCH
-- One row per file you upload. This is the spine of the whole
-- import flow and the reason you can always answer "where did
-- this number come from?"
--
-- file_hash is a SHA-256 of the file contents, marked UNIQUE.
-- That is what stops you from importing the same statement
-- twice in six months when you've forgotten you already did.
-- -----------------------------------------------------------

CREATE TABLE import_batch (
  id                 SERIAL PRIMARY KEY,
  account_id         INTEGER REFERENCES account(id),
  original_filename  TEXT NOT NULL,
  stored_path        TEXT NOT NULL,          -- where we saved the original file
  file_type          TEXT NOT NULL CHECK (file_type IN ('PDF','CSV')),
  file_hash          TEXT NOT NULL UNIQUE,

  -- UPLOADED -> PARSING -> REVIEW -> APPROVED
  --                    \-> FAILED
  status             TEXT NOT NULL DEFAULT 'UPLOADED'
                     CHECK (status IN ('UPLOADED','PARSING','REVIEW','APPROVED','FAILED')),

  period_start       DATE,
  period_end         DATE,
  rows_parsed        INTEGER NOT NULL DEFAULT 0,
  rows_approved      INTEGER NOT NULL DEFAULT 0,
  error_message      TEXT,

  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at        TIMESTAMPTZ
);

CREATE INDEX idx_import_status ON import_batch(status);

-- -----------------------------------------------------------
-- STAGED TRANSACTION
-- Parsed rows waiting for you to review them.
--
-- This table is the single most important design decision in
-- the app. Parsing a PDF is roughly 95% accurate, not 100%.
-- Nothing reaches your real transaction table without you
-- looking at it first. Silently wrong financial data is much
-- worse than data you had to spend 30 seconds confirming.
-- -----------------------------------------------------------

CREATE TABLE staged_transaction (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch_id   INTEGER NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,

  posted_date       DATE,
  description       TEXT,
  amount_cents      INTEGER,
  suggested_category TEXT,

  -- HIGH  = parsed cleanly, safe to bulk-approve
  -- LOW   = something was ambiguous, look closely
  confidence        TEXT DEFAULT 'HIGH' CHECK (confidence IN ('HIGH','MEDIUM','LOW')),

  -- if this looks like a transaction you already have, we point at it
  duplicate_of_id   INTEGER,

  review_status     TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (review_status IN ('PENDING','APPROVED','REJECTED')),

  raw_text          TEXT,     -- the original line, kept for debugging bad parses
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staged_batch ON staged_transaction(import_batch_id);

-- -----------------------------------------------------------
-- TRANSACTION
-- The permanent record. Only approved rows land here.
--
-- dedupe_hash is computed in app code from
--   account + date + amount + normalized description
-- and marked UNIQUE per account, so the database itself refuses
-- to store the same purchase twice -- even if a bug in the app
-- tries to. Constraints in the database beat checks in code,
-- because the database is the last line of defence.
-- -----------------------------------------------------------

CREATE TABLE transaction (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES account(id),
  import_batch_id  INTEGER REFERENCES import_batch(id),

  posted_date      DATE NOT NULL,
  description      TEXT NOT NULL,          -- raw text from the statement
  merchant         TEXT,                   -- cleaned up: 'AMZN MKTP US*2K4' -> 'Amazon'
  amount_cents     INTEGER NOT NULL,
  category_id      INTEGER REFERENCES category(id),
  notes            TEXT,

  dedupe_hash      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (account_id, dedupe_hash)
);

-- These three indexes cover the queries you'll actually run:
-- "this month", "everything on this card", "search my history".
CREATE INDEX idx_txn_date        ON transaction(posted_date DESC);
CREATE INDEX idx_txn_account     ON transaction(account_id, posted_date DESC);
CREATE INDEX idx_txn_description ON transaction USING gin (to_tsvector('english', description));

-- -----------------------------------------------------------
-- STATEMENT
-- The monthly summary, taken straight off the PDF.
--
-- cashback_earned_cents is read from the statement, not
-- calculated by us. Your issuer already did that math and
-- printed it. Copying their number is always correct;
-- recomputing it means modeling every cap and category rule
-- and then wondering which of you is wrong.
-- -----------------------------------------------------------

CREATE TABLE statement (
  id                     SERIAL PRIMARY KEY,
  account_id             INTEGER NOT NULL REFERENCES account(id),
  import_batch_id        INTEGER REFERENCES import_batch(id),

  period_start           DATE NOT NULL,
  period_end             DATE NOT NULL,

  opening_balance_cents  INTEGER,
  closing_balance_cents  INTEGER,
  total_spend_cents      INTEGER,
  total_payments_cents   INTEGER,

  cashback_earned_cents  INTEGER,   -- earned this period
  cashback_balance_cents INTEGER,   -- running total the issuer reports

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (account_id, period_start, period_end)
);

-- -----------------------------------------------------------
-- AUDIT LOG
-- Every meaningful action, with enough detail to reconstruct
-- what happened. You asked to log everything -- this is that.
-- 'actor' is 'system' for now and becomes a person once we
-- add login.
-- -----------------------------------------------------------

CREATE TABLE audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action       TEXT NOT NULL,        -- 'import.uploaded', 'transaction.edited'
  entity_type  TEXT,                 -- 'import_batch', 'transaction'
  entity_id    INTEGER,
  detail       JSONB,                -- whatever context matters for this action
  actor        TEXT NOT NULL DEFAULT 'system',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

COMMIT;
