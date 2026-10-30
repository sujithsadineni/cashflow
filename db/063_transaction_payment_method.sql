-- ===========================================================
-- cashflow :: migration 063 — how a row was paid, when a person says (D359)
--
-- The method a statement prints (a wallet, autopay, Zelle, ATM …) is read
-- from the row's line each time it's shown (api/src/merchants/
-- payment-method.js), like its place (D224), so nothing is stored for it.
-- No bank prints tap, chip or swipe; this column keeps a person's own pick,
-- which wins over the reading. NULL means "use what the statement says".
-- Keys are a fixed list, the same as PAYMENT_METHODS in that file.
-- ===========================================================

BEGIN;

ALTER TABLE transaction ADD COLUMN payment_method TEXT
  CHECK (payment_method IN (
    'apple_pay', 'google_pay', 'samsung_pay',
    'tap', 'chip', 'swipe', 'in_person',
    'online', 'paypal',
    'autopay', 'app', 'bill_pay', 'ach', 'zelle', 'wire', 'check', 'atm'
  ));

COMMIT;
