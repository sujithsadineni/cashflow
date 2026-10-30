-- ===========================================================
-- cashflow :: migration 051 — answers worked out on this computer (D332 step 3)
--
-- A question answered here is kept like the others, with what was found
-- as data (answer_detail: totals in cents, months, the rows behind it),
-- so the panel can show it again. `answer` holds a line without amounts
-- ("Rent · total · 2026 so far"): money becomes words only in the web
-- app (formatMoney). A question it couldn't read is kept too, as
-- not_understood, with what it said: those show which phrasings to add.
-- ===========================================================

BEGIN;

ALTER TABLE assistant_question ADD COLUMN answer_detail JSONB;

ALTER TABLE assistant_question DROP CONSTRAINT assistant_question_status_check;
ALTER TABLE assistant_question ADD CONSTRAINT assistant_question_status_check
  CHECK (status IN ('waiting', 'answered', 'not_understood', 'dismissed'));

COMMIT;
