-- ===========================================================
-- cashflow :: migration 021 — which parser a PDF import used
-- ===========================================================
--
-- 'api' (default) sends the statement to Claude, same as always.
-- 'local' runs the new deterministic, no-API-call parser
-- (parse/pdf-local.js) for the issuers it knows how to read.
-- Stored on the batch, not just passed per-call, so a retry after a
-- failure uses the same method the household chose rather than
-- silently falling back to the paid path.

ALTER TABLE import_batch
  ADD COLUMN parse_method TEXT NOT NULL DEFAULT 'api'
    CHECK (parse_method IN ('api', 'local'));
