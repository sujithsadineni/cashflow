-- ===========================================================
-- cashflow :: migration 043 — every statement's mailing address (D303)
--
-- 042 kept one address per account, from its newest statement. A person's
-- history needs every statement's: a 2023 statement mailed to an old
-- apartment is how the People page knows the previous address and when it
-- stopped. Read off page one of each PDF on approval and once as a backfill
-- (statements/mailing-address-run.js). The account columns stay as the
-- newest reading.
--
-- Personal data: local only, never published, masked in privacy mode.
-- Null when the bank prints no mailing block on page one, or for a CSV.
-- ===========================================================

BEGIN;

ALTER TABLE statement ADD COLUMN mailing_address TEXT;

COMMIT;
