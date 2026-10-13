-- ===========================================================
-- cashflow :: migration 033 — find an entity's audit entries fast
-- ===========================================================
--
-- D204: the Review re-check asks, for each of ~1,600 rows, whether the
-- household ever edited it (an EXISTS over audit_log by entity), and a
-- transaction's ＋ panel lists its own history the same way. Only
-- created_at was indexed, so both scanned the whole log, which only grows.

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id, created_at DESC);
