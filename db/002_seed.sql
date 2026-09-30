-- ===========================================================
-- Seed data: a starting category list.
--
-- People and accounts are deliberately NOT seeded. The first person
-- is created by signing up (see api/src/routes/auth.js); a second
-- person can be added the same way, or gets proposed automatically
-- when a statement's own contents reveal a name the app doesn't
-- know yet. If adding a person or an account required editing SQL,
-- the app wouldn't be finished.
-- ===========================================================

BEGIN;

-- A deliberately short list. Too many categories and you stop
-- categorizing; too few and the monthly view tells you nothing.
-- Add more as you find things that don't fit.
INSERT INTO category (name, sort_order) VALUES
  ('Rent',            10),
  ('Utilities',       20),
  ('Groceries',       30),
  ('Dining',          40),
  ('Transport',       50),
  ('Fuel',            60),
  ('Shopping',        70),
  ('Health',          80),
  ('Subscriptions',   90),
  ('Travel',         100),
  ('Entertainment',  110),
  ('Insurance',      120),
  ('Transfers',      900),   -- card payments, moving money between your own accounts
  ('Uncategorized',  999);

COMMIT;
