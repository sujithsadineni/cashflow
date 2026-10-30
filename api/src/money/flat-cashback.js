/**
 * A flat cash back rate for a card that prints none (D330): Robinhood's
 * Gold Card pays 3% on purchases and takes 3% back on a refund, and its
 * statement says nothing about rewards. The owner sets the rate on the
 * account (account.cashback_rate_bps, 300 = 3%); every other card stays
 * read off its statement.
 *
 * The rule is SQL, written once here, so the card's table, Overview's
 * tiles and the Cashback explorer can't drift apart:
 *   - a purchase (money out) earns the rate, rounded to the cent, per row
 *   - a refund (money in) takes the rate back, the same way
 *   - nothing else earns: the card's own membership fee, interest, fees,
 *     payments, cashback itself
 * A statement's cash back is the sum of its rows, counted when it closes,
 * as Apple's Daily Cash is (money/cashback.js treats the card as paid out).
 */

// The card's own membership charge ("GOLD ANNUAL SUBSCRIPTIO"): a fee in a purchase's clothing.
export const OWN_FEE_SOURCE = '^GOLD (ANNUAL|MONTHLY) SUBSCRIPTIO';

/** One row's cash back in cents, or NULL when it earns none. `t` is the transaction alias, `a` its account. */
export const rowCashbackSql = (t = 't', a = 'a') => `(CASE
  WHEN ${a}.cashback_rate_bps IS NULL OR ${t}.description ~* '${OWN_FEE_SOURCE}' THEN NULL
  WHEN ${t}.txn_type = 'purchase' AND ${t}.amount_cents < 0 THEN round(-${t}.amount_cents * ${a}.cashback_rate_bps / 10000.0)::int
  WHEN ${t}.txn_type = 'refund' AND ${t}.amount_cents > 0 THEN -round(${t}.amount_cents * ${a}.cashback_rate_bps / 10000.0)::int
END)`;

/**
 * Statements with the cash back they earned: printed, or, on a card with
 * a flat rate, the sum of its rows. Used in place of the statement table
 * wherever cashback is summed. `calculated` says which.
 */
export const STATEMENT_CASHBACK_SQL = `(SELECT s.id, s.account_id, s.import_batch_id, s.period_end, s.cashback_balance_cents, s.cashback_balance_as_of,
       COALESCE(s.cashback_earned_cents, calc.cents) AS cashback_earned_cents,
       s.cashback_earned_cents IS NULL AND calc.cents IS NOT NULL AS calculated,
       calc.rate_bps
  FROM statement s
  -- Summed once, over the flat-rate cards' rows only, then joined: not a
  -- subquery per statement (that ran Overview's month trend for minutes).
  LEFT JOIN (
    SELECT t.import_batch_id, SUM(${rowCashbackSql('t', 'a')})::int AS cents, MAX(a.cashback_rate_bps) AS rate_bps
      FROM transaction t JOIN account a ON a.id = t.account_id
     WHERE a.cashback_rate_bps IS NOT NULL AND t.import_batch_id IS NOT NULL
     GROUP BY t.import_batch_id
  ) calc ON calc.import_batch_id = s.import_batch_id)`;
