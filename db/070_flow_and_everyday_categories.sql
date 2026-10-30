-- ===========================================================
-- cashflow :: migration 070 — the categories the app's own rules file into (D417)
--
-- A fresh install started with fourteen categories, but the rules that
-- file a row by what it is (a card payment, a Zelle, a refund, cash back,
-- pay, a transfer to a brokerage) suggest categories it didn't have, so
-- on a first import 2,000 of 2,800 uncategorized rows were rows a rule
-- had already understood. Added where missing, by name: an install that
-- has them (or renamed one) keeps its own. With them, the everyday ones a
-- household's purchases need beyond the starting fourteen.
-- ===========================================================

BEGIN;

INSERT INTO category (name, sort_order)
SELECT v.name, v.sort_order
  FROM (VALUES
    ('Clothing', 75), ('Personal Care', 76), ('Home', 77), ('Education', 78), ('Phone', 79),
    ('Fitness', 85), ('EV Charging', 84), ('Auto Maintenance', 86), ('Parking & Tolls', 87), ('Government', 88), ('Gifts & Donations', 89),
    ('Salary', 160), ('Tax-Refund', 161), ('Cash Deposit', 162), ('Refund', 163), ('Cashback', 164),
    ('Card Payment', 170), ('Zelle', 171), ('Investment', 172), ('Savings', 173), ('Loan', 174),
    ('Balance Transfer', 175), ('Balance Transfer Fee', 176), ('Annual Fee', 177)
  ) AS v(name, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM category c WHERE lower(c.name) = lower(v.name));

COMMIT;
