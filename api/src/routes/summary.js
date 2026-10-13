/**
 * The monthly summary — one endpoint, one round trip, aggregation in
 * SQL. Answers "how did this month go?" for the Overview page.
 *
 * Month boundaries are calendar months, not statement periods. The
 * one exception is cashback, which is read off statements (we never
 * calculate it) — a statement belongs to the month its period ends in.
 *
 * "Spent" nets refunds against purchases: it's the normal negative-
 * amount spend total, plus any `refund`-typed row regardless of sign
 * (a returned purchase's refund, a positive amount, offsets the
 * original purchase instead of being invisible to the total). Only
 * `refund` is allowed to offset — an untyped positive row or interest
 * income is not a refund and must not quietly reduce "how much I
 * spent" (a real bug caught by checking this against live data: an
 * earlier version of this fix excluded deposit/cashback/payment/
 * transfer and let everything else positive net against spend,
 * which included a NULL-typed transfer and interest income).
 * Clamped at 0 with LEAST so a month with unusually large refunds
 * shows "$0 spent", never a negative spend figure.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { savingsBreakdown, linkDestinations } from '../savings-breakdown.js';
import { runSummaryQueries } from './summary/queries.js';
import { assembleSummary } from './summary/assemble.js';

export const summaryRouter = Router();

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// The queries live in summary/queries.js and the arithmetic in the pure
// summary/assemble.js (D220); this route only picks the month.
summaryRouter.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = req.query.month ?? currentMonth;

    if (!MONTH_RE.test(month)) {
      return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    }

    res.json(assembleSummary(month, await runSummaryQueries(`${month}-01`)));
  } catch (err) {
    next(err);
  }
});

/**
 * Where Savings went (D179): the selected month and the year so far,
 * each as "how much the accounts in the app changed" plus the flows
 * Savings leaves out. See savings-breakdown.js.
 */
summaryRouter.get('/savings-breakdown', async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!MONTH_RE.test(month ?? '')) return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    const start = `${month}-01`;
    const { rows } = await query(
      `SELECT to_char(t.posted_date, 'YYYY-MM') AS month, t.amount_cents, t.txn_type, t.merchant, t.description,
              c.name AS category_name
         FROM transaction t
         LEFT JOIN category c ON c.id = t.category_id
        WHERE t.posted_date >= date_trunc('year', $1::date)
          AND t.posted_date < $1::date + interval '1 month'`,
      [start]
    );
    const { rows: accounts } = await query(
      `SELECT a.id, a.name, a.issuer, a.account_type, mb.balance_cents AS manual_balance_cents,
              to_char(mb.as_of, 'YYYY-MM-DD') AS manual_balance_as_of
         FROM account a
         LEFT JOIN LATERAL (SELECT balance_cents, as_of FROM account_balance WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1) mb ON true
        WHERE a.is_active AND a.account_type IN ('SAVINGS', 'INVESTMENT')`
    );
    const linked = (b) => ({ ...b, lines: linkDestinations(b.lines, accounts) });
    res.json({
      month: linked(savingsBreakdown(rows.filter((r) => r.month === month))),
      year_to_date: linked(savingsBreakdown(rows)),
    });
  } catch (err) {
    next(err);
  }
});
