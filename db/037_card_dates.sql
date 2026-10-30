-- ===========================================================
-- cashflow :: migration 037 — when a card closes and when it's due
-- ===========================================================
--
-- D270. Every card statement prints its payment due date and minimum
-- payment; neither was kept. They're read off the statement now
-- (parse/statement-dates.js) and stored with it: the printed date is
-- the truth, weekends and holidays included.
--
-- A card also gets its usual closing day and due day ("closes on the
-- 5th, due on the 2nd"): learned from its statements for a new card,
-- suggested in its edit form, and the fallback when a statement's own
-- date isn't known. Days 1–31; a month without the 31st uses its last.
--
-- And a new alert: a card payment due within days, or past due, with
-- what's still owed on that statement.

ALTER TABLE statement
  ADD COLUMN payment_due_date      DATE,
  ADD COLUMN minimum_payment_cents INTEGER;

ALTER TABLE account
  ADD COLUMN closing_day SMALLINT CHECK (closing_day BETWEEN 1 AND 31),
  ADD COLUMN due_day     SMALLINT CHECK (due_day BETWEEN 1 AND 31);

ALTER TABLE alert DROP CONSTRAINT alert_type_check;
ALTER TABLE alert ADD CONSTRAINT alert_type_check
  CHECK (type IN ('OVERDUE_STATEMENT', 'MISSED_RECURRING', 'NEW_RECURRING', 'PENDING_REVIEW', 'CARD_PAYMENT_DUE'));
