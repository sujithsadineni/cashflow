-- ===========================================================
-- cashflow :: migration 067 — Interest, Interest Earned and Bank Fees for every install (D402)
--
-- The statement readers file interest charged under Interest, interest
-- paid to the household under Interest Earned and a bank's own charges
-- under Bank Fees (D342), but a new install started with fourteen
-- categories and none of these: every interest and fee row arrived
-- uncategorized and sat in Review. Added where missing, by name, so an
-- install that already made them (this household's) is left as it is.
-- ===========================================================

BEGIN;

INSERT INTO category (name, sort_order)
SELECT v.name, v.sort_order
  FROM (VALUES ('Interest', 130), ('Interest Earned', 140), ('Bank Fees', 150)) AS v(name, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM category c WHERE lower(c.name) = lower(v.name));

COMMIT;
