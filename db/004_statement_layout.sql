-- ===========================================================
-- cashflow :: migration 004 — statement layout cache
--
-- One row per issuer+account-type combination we've seen a PDF
-- statement from. Page classification (stage 2) is free and always
-- runs in full — this table doesn't skip it. What it buys:
--
--   1. Drift detection: does this statement's page pattern match
--      what we saw last time from this issuer? A mismatch means the
--      issuer changed their template, or the transaction volume
--      pushed the layout onto a different page count — worth
--      flagging, never silently trusted.
--   2. Column hints for the extraction prompt: the transaction-table
--      header phrase this issuer uses, learned once and reused.
--   3. Reporting: "known issuer, layout matched" vs "new template".
-- ===========================================================

BEGIN;

CREATE TABLE statement_layout (
  id                SERIAL PRIMARY KEY,
  issuer_key        TEXT NOT NULL UNIQUE,   -- e.g. 'bank_of_america/checking'
  page_count        INTEGER NOT NULL,
  page_roles        TEXT[] NOT NULL,        -- e.g. {SUMMARY,BOILERPLATE,TRANSACTIONS,SUMMARY}
  header_signature  TEXT,                   -- the transaction-table header phrase seen
  column_hints      JSONB,
  times_seen        INTEGER NOT NULL DEFAULT 1,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
