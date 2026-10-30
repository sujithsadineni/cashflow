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
import { query } from '../core/db.js';
import { savingsBreakdown, savingsYear, linkDestinations } from '../money/savings-breakdown.js';
import { runSummaryQueries } from './summary/queries.js';
import { assembleSummary } from './summary/assemble.js';
import { cashbackYear } from '../money/cashback.js';
import { STATEMENT_CASHBACK_SQL } from '../money/flat-cashback.js';
import { feesYear, FEE_REFUND_SQL } from '../money/fees.js';
import { investmentYear, indiaYear } from '../money/category-flows.js';
import { explorerResponse } from '../money/year-explorer.js';
import { zelleYear } from '../money/zelle.js';
import { spendSql, spenderSql } from '../money/spend.js';
import { whereRange } from '../money/where-range.js';
import { validateQuery, whereQuerySchema } from '../core/validate.js';

export const summaryRouter = Router();

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// The queries live in summary/queries.js and the arithmetic in the pure
// summary/assemble.js (D220); this route only picks the month.
/**
 * "Where it's going" (D373): spend by category for a month or the year so
 * far, for the household or one person. The same spend rule as the
 * monthly summary's by_category (spendSql, netted per category and
 * clamped at 0) and the same "whose row" rule as every by-person figure
 * (spenderSql, D344), so a month here matches the Overview to the cent.
 */
function whereFilter({ month, span, person_id }) {
  const { from, to } = whereRange(month, span);
  const values = [from, to];
  const where = [`(${spendSql('t')})`, 't.posted_date >= $1::date', 't.posted_date < $2::date'];
  if (person_id !== undefined) { values.push(person_id); where.push(`${spenderSql('t', 'a')} = $${values.length}`); }
  return { from, to, values, where };
}

summaryRouter.get('/where', validateQuery(whereQuerySchema), async (req, res, next) => {
  try {
    const { from, to, values, where } = whereFilter(req.filters);
    const { rows } = await query(
      `SELECT t.category_id, COALESCE(c.name, 'Uncategorized') AS name, c.icon_key,
              COUNT(*)::int AS count, SUM(t.amount_cents)::bigint AS spend_cents
         FROM transaction t
         JOIN account a ON a.id = t.account_id
         LEFT JOIN category c ON c.id = t.category_id
        WHERE ${where.join(' AND ')}
        GROUP BY t.category_id, c.name, c.icon_key
        ORDER BY SUM(t.amount_cents) ASC, c.name`,
      values
    );
    // A category whose refunds outweigh its spend nets to money back: it isn't
    // a place the money went, but it still lowers the Overview's Spent, so it's
    // reported beside the categories and the card can add up to Spent exactly.
    const net = rows.map((r) => ({ ...r, net: Number(r.spend_cents) }));
    const categories = net.filter((r) => r.net < 0).map(({ net: n, ...r }) => ({ ...r, spend_cents: n }));
    const total_cents = categories.reduce((s, c) => s + c.spend_cents, 0);
    const refunds_over_cents = net.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0);
    res.json({ from, to, total_cents, refunds_over_cents, net_cents: total_cents + refunds_over_cents, categories });
  } catch (err) {
    next(err);
  }
});

/** One category's spend rows for the same span (D373): the panel beside "Where it's going". */
summaryRouter.get('/where/transactions', validateQuery(whereQuerySchema), async (req, res, next) => {
  try {
    const { category_id } = req.filters;
    if (category_id === undefined) return res.status(400).json({ error: 'Pick a category', field: 'category_id' });
    const { values, where } = whereFilter(req.filters);
    if (category_id === 'none') where.push('t.category_id IS NULL');
    else { values.push(category_id); where.push(`t.category_id = $${values.length}`); }
    const { rows } = await query(
      `SELECT t.id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date,
              t.merchant, t.description, t.amount_cents, ct.name AS contact_name, ct.nickname AS contact_nickname,
              a.name AS account_name, a.nickname AS account_nickname, a.mask AS account_mask,
              (SELECT count(*) FROM account x WHERE x.nickname = a.nickname AND x.is_active) > 1 AS account_nickname_shared
         FROM transaction t
         JOIN account a ON a.id = t.account_id
         LEFT JOIN contact ct ON ct.id = t.contact_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.posted_date DESC, t.id DESC
        LIMIT 2000`,
      values
    );
    res.json({ transactions: rows });
  } catch (err) {
    next(err);
  }
});

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
      // The newer of a hand-entered balance (D180) and the latest statement's
      // closing balance: an account with statements needs no typing (D267).
      `SELECT a.id, a.name, a.issuer, a.account_type,
              CASE WHEN sb.as_of IS NOT NULL AND (mb.as_of IS NULL OR sb.as_of > mb.as_of) THEN sb.balance_cents ELSE mb.balance_cents END AS balance_cents,
              to_char(CASE WHEN sb.as_of IS NOT NULL AND (mb.as_of IS NULL OR sb.as_of > mb.as_of) THEN sb.as_of ELSE mb.as_of END, 'YYYY-MM-DD') AS balance_as_of
         FROM account a
         LEFT JOIN LATERAL (SELECT balance_cents, as_of FROM account_balance WHERE account_id = a.id ORDER BY as_of DESC LIMIT 1) mb ON true
         LEFT JOIN LATERAL (SELECT s.closing_balance_cents AS balance_cents, s.period_end AS as_of
                              FROM statement s JOIN import_batch b ON b.id = s.import_batch_id
                             WHERE b.account_id = a.id AND s.closing_balance_cents IS NOT NULL
                             ORDER BY s.period_end DESC LIMIT 1) sb ON true
         WHERE a.is_active AND a.account_type IN ('SAVINGS', 'INVESTMENT')
         ORDER BY a.name`
    );
    const linked = (b) => ({ ...b, lines: linkDestinations(b.lines, accounts) });
    res.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        account_type: a.account_type,
        balance_cents: a.balance_cents == null ? null : Number(a.balance_cents),
        as_of: a.balance_as_of,
      })),
      month: linked(savingsBreakdown(rows.filter((r) => r.month === month))),
      year_to_date: linked(savingsBreakdown(rows)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Savings transactions for one year (D295): every saved row, classified
 * using savings-breakdown.js, with excluded flows reversed into the total.
 */
summaryRouter.get('/savings', async (req, res, next) => {
  try {
    const year = req.query.year ?? String(new Date().getFullYear());
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Use year=YYYY', field: 'year' });
    const [{ rows }, { rows: accounts }] = await Promise.all([
      query(`SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.txn_type,
                    t.description, t.merchant, c.name AS category_name
               FROM transaction t LEFT JOIN category c ON c.id = t.category_id`),
      query('SELECT id, name, issuer, mask, account_type, image_path, color FROM account'),
    ]);
    res.json(explorerResponse({
      year,
      build: (y) => savingsYear({ rows, accounts, year: y }),
      dates: rows.map((r) => r.posted_date),
    }));
  } catch (err) {
    next(err);
  }
});

/**
 * Money back for one year, counted when it's received (D283): by month, by
 * card with what each still holds, and every row behind it. Also the year
 * before up to the same month, and which years have any.
 */
summaryRouter.get('/cashback', async (req, res, next) => {
  try {
    const year = req.query.year ?? String(new Date().getFullYear());
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Use year=YYYY', field: 'year' });
    const [{ rows }, { rows: statements }, { rows: interest }, { rows: accounts }, { rows: redemptions }] = await Promise.all([
      query(`SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.description, t.merchant
               FROM transaction t LEFT JOIN category c ON c.id = t.category_id
              WHERE t.txn_type = 'cashback' OR c.name = 'Cashback'`),
      query(`SELECT id, account_id, to_char(period_end, 'YYYY-MM-DD') AS period_end, cashback_earned_cents, cashback_balance_cents,
                    to_char(cashback_balance_as_of, 'YYYY-MM-DD') AS cashback_balance_as_of, calculated, rate_bps
               FROM ${STATEMENT_CASHBACK_SQL} s`),
      query(`SELECT id, account_id, to_char(posted_date, 'YYYY-MM-DD') AS posted_date, amount_cents, description, merchant
               FROM transaction WHERE txn_type = 'interest' AND amount_cents > 0`),
      query('SELECT id, name, issuer, mask, account_type, image_path, color FROM account'),
      query(`SELECT id, account_id, to_char(redeemed_on, 'YYYY-MM-DD') AS redeemed_on, brand, value_cents, rewards_used_cents, points_used, note
               FROM reward_redemption WHERE voided_at IS NULL`),
    ]);
    const input = { rows, statements, interest, accounts, redemptions };
    const current = cashbackYear({ ...input, year });
    const before = cashbackYear({ ...input, year: String(Number(year) - 1) });
    const now = new Date();
    const through = Number(year) === now.getFullYear() ? now.getMonth() + 1 : 12;
    const years = [...new Set([...rows.map((r) => r.posted_date), ...statements.filter((s) => s.cashback_earned_cents != null).map((s) => s.period_end), ...redemptions.map((r) => r.redeemed_on)]
      .map((d) => Number(d.slice(0, 4))))].sort((a, b) => b - a);
    res.json({
      ...current,
      through_month: through,
      previous_year: { year: before.year, total_cents: before.total_cents, to_date_cents: before.months.slice(0, through).reduce((a, m) => a + m.total, 0) },
      years,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Fees & Interest for one year (D285): every fee and interest charge less
 * the fees a bank gave back, by month, kind and account, and the rows.
 * Same shape as /cashback, so the two details share one explorer.
 */
summaryRouter.get('/fees', async (req, res, next) => {
  try {
    const year = req.query.year ?? String(new Date().getFullYear());
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Use year=YYYY', field: 'year' });
    const [{ rows }, { rows: accounts }] = await Promise.all([
      query(`SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.txn_type,
                    t.description, t.merchant, c.name AS category_name
               FROM transaction t LEFT JOIN category c ON c.id = t.category_id
              WHERE t.amount_cents != 0
                AND (t.txn_type = 'fee' OR (t.txn_type = 'interest' AND t.amount_cents < 0) OR ${FEE_REFUND_SQL})`),
      query('SELECT id, name, issuer, mask, account_type, image_path, color FROM account'),
    ]);
    res.json(explorerResponse({ year, build: (y) => feesYear({ rows, accounts, year: y }), dates: rows.map((r) => r.posted_date) }));
  } catch (err) {
    next(err);
  }
});

/**
 * Credit used, month by month for one year (D358): each open card's line as
 * of each month's end, by the same rule as Overview's Credit used card
 * (D346, D354): its newest statement closing by then that prints a limit,
 * else the limit the household set against that month's newest statement.
 * The household's share is summed on the page, from these.
 */
summaryRouter.get('/credit', async (req, res, next) => {
  try {
    const year = req.query.year ?? String(new Date().getFullYear());
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Use year=YYYY', field: 'year' });
    const { rows: years } = await query(
      `SELECT DISTINCT extract(year FROM s.period_end)::int AS y FROM statement s JOIN account a ON a.id = s.account_id
        WHERE a.account_type = 'CREDIT_CARD' AND (s.credit_limit_cents IS NOT NULL OR a.credit_limit_manual_cents IS NOT NULL) ORDER BY 1`);
    const now = new Date();
    const through = Number(year) < now.getFullYear() ? 12 : Number(year) > now.getFullYear() ? 0 : now.getMonth() + 1;
    const { rows } = await query(
      `SELECT to_char(m.month, 'YYYY-MM') AS month, a.id, a.name, a.nickname, a.mask, a.account_type, a.is_active,
              CASE WHEN cl.as_of IS NOT NULL THEN json_build_object(
                'credit_limit_cents', cl.credit_limit_cents, 'available_credit_cents', cl.available_credit_cents,
                'closing_balance_cents', cl.closing_balance_cents, 'as_of', cl.as_of)
              WHEN a.credit_limit_manual_cents IS NOT NULL AND ns.as_of IS NOT NULL THEN json_build_object(
                'credit_limit_cents', a.credit_limit_manual_cents, 'available_credit_cents', NULL,
                'closing_balance_cents', ns.closing_balance_cents, 'as_of', ns.as_of, 'source', 'manual') END AS credit_line
         FROM generate_series(make_date($1::int, 1, 1), make_date($1::int, 1, 1) + interval '11 months', interval '1 month') AS m(month)
         CROSS JOIN account a
         LEFT JOIN LATERAL (
           SELECT s.credit_limit_cents, s.available_credit_cents, s.closing_balance_cents, to_char(s.period_end, 'YYYY-MM-DD') AS as_of
             FROM statement s WHERE s.account_id = a.id AND s.credit_limit_cents IS NOT NULL AND s.period_end < m.month + interval '1 month'
            ORDER BY s.period_end DESC LIMIT 1) cl ON true
         LEFT JOIN LATERAL (
           SELECT s.closing_balance_cents, to_char(s.period_end, 'YYYY-MM-DD') AS as_of
             FROM statement s WHERE s.account_id = a.id AND s.period_end < m.month + interval '1 month'
            ORDER BY s.period_end DESC LIMIT 1) ns ON true
        WHERE a.account_type = 'CREDIT_CARD' AND a.is_active
        ORDER BY m.month, a.name`,
      [Number(year)]
    );
    const months = [];
    for (const r of rows) {
      if (months.at(-1)?.month !== r.month) months.push({ month: r.month, cards: [] });
      const { month: _m, ...card } = r;
      months.at(-1).cards.push(card);
    }
    res.json({ year: Number(year), years: years.map((y) => y.y), through_month: through, months });
  } catch (err) {
    next(err);
  }
});

const ROWS_SELECT = `SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.txn_type,
                           t.description, t.merchant, c.name AS category_name
                      FROM transaction t JOIN category c ON c.id = t.category_id`;

/**
 * Investment and To India for one year (D286): the rows of their one
 * category, by month, kind (how or through whom it went) and account.
 * Investment also says how much has gone in since the first one on file.
 */
for (const [path, category, build] of [['investment', 'Investment', investmentYear], ['india', 'Transfer to India', indiaYear]]) {
  summaryRouter.get(`/${path}`, async (req, res, next) => {
    try {
      const year = req.query.year ?? String(new Date().getFullYear());
      if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Use year=YYYY', field: 'year' });
      const [{ rows }, { rows: accounts }] = await Promise.all([
        query(`${ROWS_SELECT} WHERE c.name = $1`, [category]),
        query('SELECT id, name, issuer, mask, account_type, image_path, color FROM account'),
      ]);
      res.json({
        ...explorerResponse({ year, build: (y) => build({ rows, accounts, year: y }), dates: rows.map((r) => r.posted_date) }),
        all_time_cents: rows.reduce((a, r) => a + r.amount_cents, 0),
        first_date: rows.map((r) => r.posted_date).sort()[0] ?? null,
      });
    } catch (err) {
      next(err);
    }
  });
}

/**
 * Zelle for one year (D288): sent, received and between you, by month and
 * by person, every row with who it was with. Also how many rows still
 * wait for review, across every year, so the card can open on them.
 */
summaryRouter.get('/zelle', async (req, res, next) => {
  try {
    const year = req.query.year ?? String(new Date().getFullYear());
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Use year=YYYY', field: 'year' });
    const [{ rows }, { rows: accounts }] = await Promise.all([
      query(`SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.txn_type,
                    t.description, t.merchant, t.zelle_type, t.zelle_person, t.contact_id,
                    ct.name AS contact_name, ct.nickname AS contact_nickname, ct.image_path AS contact_image_path
               FROM transaction t LEFT JOIN contact ct ON ct.id = t.contact_id
              WHERE t.description ILIKE '%zelle%'`),
      query('SELECT id, name, issuer, mask, account_type, image_path, color FROM account'),
    ]);
    res.json({
      ...explorerResponse({ year, build: (y) => zelleYear({ rows, accounts, year: y }), dates: rows.map((r) => r.posted_date) }),
      needs_review: rows.filter((r) => !r.zelle_type).length,
    });
  } catch (err) {
    next(err);
  }
});
