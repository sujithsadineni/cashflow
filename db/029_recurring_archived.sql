-- ===========================================================
-- cashflow :: migration 029 — archived recurring series
-- ===========================================================
--
-- D185: the recurring feature was rebuilt from scratch and the owner
-- chose to start fresh. The old series are archived, not deleted:
-- kept as history, invisible to the page, matching and detection. An
-- archived series is different from an ENDED one, which is a live
-- decision ("this subscription is cancelled") the new logic respects.

ALTER TABLE recurring_series DROP CONSTRAINT recurring_series_status_check;
ALTER TABLE recurring_series ADD CONSTRAINT recurring_series_status_check
  CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'));
