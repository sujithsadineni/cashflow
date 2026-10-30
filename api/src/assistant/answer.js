/**
 * Answers a parsed question from the ledger (D332 step 3): facts in cents,
 * never words with money in them. The panel words them (formatMoney is the
 * only code allowed to divide by 100). Spending is the app's one rule
 * (money/spend.js), so an answer matches Overview: money out, less refunds
 * (a roommate's Zelle share booked as a Rent refund lowers rent), not
 * counting card payments, transfers or savings.
 *
 * Every value is a parameter. The SQL text that varies is fixed fragments
 * chosen by subject kind, never anything from the question.
 */

import { spendSql } from '../money/spend.js';
import { monthsIn } from './periods.js';

const SPEND = spendSql('t');
const ROWS_SHOWN = 100;

/** WHERE for the subjects: what (categories, merchants) OR'd, which cards AND'ed. */
export function subjectWhere(subjects, values) {
  const what = [];
  const cats = subjects.filter((s) => s.kind === 'category').map((s) => s.id);
  const merchants = subjects.filter((s) => s.kind === 'merchant').map((s) => s.name);
  const accounts = subjects.filter((s) => s.kind === 'account').flatMap((s) => s.ids);
  if (cats.length) { values.push(cats); what.push(`t.category_id = ANY($${values.length}::int[])`); }
  if (merchants.length) { values.push(merchants); what.push(`t.merchant = ANY($${values.length}::text[])`); }
  const parts = [];
  if (what.length) parts.push(`(${what.join(' OR ')})`);
  if (accounts.length) { values.push(accounts); parts.push(`t.account_id = ANY($${values.length}::int[])`); }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

const inPeriod = (p, values) => {
  values.push(p.from, p.to);
  return `t.posted_date BETWEEN $${values.length - 1}::date AND $${values.length}::date`;
};

async function totals(query, subjects, p) {
  const values = [];
  const where = `${subjectWhere(subjects, values)} AND ${inPeriod(p, values)} AND ${SPEND}`;
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE t.amount_cents < 0)::int AS count,
            COALESCE(-SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS paid_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS back_cents,
            COUNT(*) FILTER (WHERE t.amount_cents > 0)::int AS back_count
       FROM transaction t WHERE ${where}`,
    values
  );
  const r = rows[0];
  const paid = Number(r.paid_cents);
  const back = Number(r.back_cents);
  // Net never below zero, like Overview's LEAST(SUM, 0): refunds can't make spending negative.
  return { ...p, count: r.count, paid_cents: paid, back_cents: back, back_count: r.back_count, net_cents: Math.max(paid - back, 0) };
}

async function byMonth(query, subjects, p) {
  const values = [];
  const where = `${subjectWhere(subjects, values)} AND ${inPeriod(p, values)} AND ${SPEND}`;
  const { rows } = await query(
    `SELECT to_char(t.posted_date, 'YYYY-MM') AS month,
            COALESCE(-SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS paid_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS back_cents,
            COUNT(*) FILTER (WHERE t.amount_cents < 0)::int AS count
       FROM transaction t WHERE ${where} GROUP BY 1`,
    values
  );
  // Net per month is not clamped at zero: a month where more came back than went out (a
  // roommate's share for two months) shows below zero, so the months add up to the total.
  const by = new Map(rows.map((r) => [r.month, r]));
  return monthsIn(p).map((month) => {
    const r = by.get(month);
    const paid = Number(r?.paid_cents ?? 0);
    const back = Number(r?.back_cents ?? 0);
    return { month, paid_cents: paid, back_cents: back, net_cents: paid - back, count: r?.count ?? 0 };
  });
}

async function topList(query, subjects, p, { of, n }) {
  const values = [];
  const where = `${subjectWhere(subjects, values)} AND ${inPeriod(p, values)} AND ${SPEND}`;
  values.push(n);
  const limit = `$${values.length}`;
  if (of === 'purchases') {
    const { rows } = await query(
      `SELECT t.id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, COALESCE(t.merchant, t.description) AS name,
              -t.amount_cents AS net_cents, a.name AS account_name
         FROM transaction t JOIN account a ON a.id = t.account_id
        WHERE ${where} AND t.amount_cents < 0 ORDER BY t.amount_cents ASC, t.id LIMIT ${limit}`,
      values
    );
    return rows.map((r) => ({ ...r, net_cents: Number(r.net_cents) }));
  }
  // A row with no merchant name is grouped by its description, not lumped with every other unnamed row.
  const group = of === 'categories' ? "COALESCE(c.name, 'Uncategorized')" : 'COALESCE(t.merchant, t.description)';
  const { rows } = await query(
    `SELECT ${group} AS name, GREATEST(-SUM(t.amount_cents), 0)::bigint AS net_cents, COUNT(*) FILTER (WHERE t.amount_cents < 0)::int AS count
       FROM transaction t LEFT JOIN category c ON c.id = t.category_id
      WHERE ${where} GROUP BY 1 HAVING -SUM(t.amount_cents) > 0 ORDER BY 2 DESC, 1 LIMIT ${limit}`,
    values
  );
  return rows.map((r) => ({ ...r, net_cents: Number(r.net_cents) }));
}

/** The rows behind an answer, newest first, so the person can check it. */
async function rowsBehind(query, subjects, periods) {
  const values = [];
  const span = { from: periods.map((p) => p.from).sort()[0], to: periods.map((p) => p.to).sort().at(-1) };
  const where = `${subjectWhere(subjects, values)} AND ${inPeriod(span, values)} AND ${SPEND}`;
  const { rows } = await query(
    `SELECT t.id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, COALESCE(t.merchant, t.description) AS name,
            t.amount_cents, t.txn_type, a.name AS account_name, c.name AS category_name, COUNT(*) OVER () AS total
       FROM transaction t JOIN account a ON a.id = t.account_id LEFT JOIN category c ON c.id = t.category_id
      WHERE ${where} ORDER BY t.posted_date DESC, t.id DESC LIMIT ${ROWS_SHOWN}`,
    values
  );
  return { rows: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}

/**
 * The answer: { intent, subjects, periods (with totals), months?, top?,
 * rows, rows_total, latest, notes }. `latest` is the newest saved day; a
 * period reaching past it gets a note, since statements after it aren't in.
 */
export async function answerQuestion(query, plan) {
  const { intent, subjects } = plan;
  const periods = [];
  for (const p of plan.periods) periods.push(await totals(query, subjects, p));
  const result = { intent, subjects, periods };
  if (intent === 'by_month') result.months = await byMonth(query, subjects, plan.periods[0]);
  if (intent === 'top') result.top = { ...plan.top, items: await topList(query, subjects, plan.periods[0], plan.top) };
  const behind = await rowsBehind(query, subjects, plan.periods);
  result.rows = behind.rows;
  result.rows_total = behind.total;

  const { rows } = await query(`SELECT to_char(MAX(posted_date), 'YYYY-MM-DD') AS latest FROM transaction`);
  result.latest = rows[0].latest;
  result.notes = [];
  if (result.latest && plan.periods.some((p) => p.to > result.latest)) result.notes.push({ kind: 'after_latest', latest: result.latest });
  if (plan.also) result.notes.push({ kind: 'also', word: plan.also.word, options: plan.also.options.map((o) => o.name) });
  return result;
}

/** A line for the questions log: what was answered, without amounts (they're words only in the panel). */
export function answerSummary(plan) {
  const what = plan.subjects.length ? plan.subjects.map((s) => s.name).join(' + ') : 'All spending';
  const how = { total: 'total', compare: 'compared', by_month: 'by month', top: `top ${plan.top?.n} ${plan.top?.of}` }[plan.intent];
  return `${what} · ${how} · ${plan.periods.map((p) => p.label).join(' vs ')}`;
}

/** The vocabulary's lists, from the database. */
export async function loadVocabLists(query) {
  const [categories, merchants, accounts] = await Promise.all([
    query('SELECT id, name FROM category'),
    query('SELECT merchant AS name, COUNT(*)::int AS count FROM transaction WHERE merchant IS NOT NULL GROUP BY merchant'),
    query('SELECT id, name FROM account'),
  ]);
  return { categories: categories.rows, merchants: merchants.rows, accounts: accounts.rows };
}
