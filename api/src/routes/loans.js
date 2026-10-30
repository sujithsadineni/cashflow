/**
 * Loans: debt tracked outside the normal statement pipeline.
 *
 * A loan doesn't always correspond to an `account` — the Wells Fargo
 * car loan has no statements uploaded anywhere in this app, it's just
 * a recurring debit on the Chase checking account. A 0% APR
 * balance-transfer card, by contrast, IS a real account with its own
 * statements. `linked_account_id` is the optional bridge for that
 * case; everything else here is manual entry, same spirit as the
 * account color/image PATCH pattern already used elsewhere.
 *
 * No parsing, no amortization math, no interest calculation — you
 * tell it the current balance and the deadline (payoff target, or a
 * promo rate's end date), same as cashback: read the number off
 * reality, don't compute it.
 */

import { Router } from 'express';
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { changesBetween } from '../core/changes.js';
import { validate, loanCreateSchema, loanUpdateSchema } from '../core/validate.js';
import { balanceTransferStatus, balanceTransferSuggestions } from '../money/balance-transfer.js';
import { installmentSuggestions } from '../money/installment-loans.js';
import { loanPaymentStatus } from '../money/loan-payments.js';

export const loansRouter = Router();

const orNull = (value) => (value === '' || value === undefined ? null : value);

/**
 * A loan's linked account must be a credit card. The whole point of
 * linking is reading `statement.closing_balance_cents` as "money
 * owed" — true for a credit card, but the opposite meaning for a
 * checking/savings account, where a positive closing balance is money
 * you HAVE. Linking to the wrong type wouldn't error anywhere; it
 * would just silently show a real number that means the wrong thing.
 */
async function assertLinkableAccount(accountId) {
  const { rows } = await query('SELECT account_type FROM account WHERE id = $1', [accountId]);
  if (rows.length === 0) return { ok: false, error: 'That account does not exist' };
  if (rows[0].account_type !== 'CREDIT_CARD') {
    return {
      ok: false,
      error: 'A loan can only link to a credit card account — its balance means money owed, unlike a checking or savings balance',
    };
  }
  return { ok: true };
}

/**
 * Three ways a loan's balance can be known, tried in this order:
 *
 *   1. Read off the linked account's own most recent statement
 *      (`statement.closing_balance_cents`) — the issuer's own printed
 *      number, exact, updates itself every time a new statement is
 *      approved. Only possible when linked_account_id is set AND that
 *      account actually has a statement yet. Assumes the linked
 *      account is a credit card, where a positive closing balance
 *      means money owed — the only kind of account a loan makes sense
 *      linked to.
 *   2. Estimated as payment x months-left, when a monthly payment,
 *      term, and start date are all known but there's no linked
 *      statement to read from (the Wells Fargo car loan's situation —
 *      it has no account of its own). `months_elapsed` is whole
 *      calendar months since start_date — coarse on purpose (the
 *      household doesn't know the exact start date either, per the
 *      owner directly), not a day-accurate amortization schedule.
 *   3. The plain manually-entered `current_balance_cents`, when
 *      neither of the above applies.
 *
 * Kept as one SQL expression, reused identically in this file's list
 * query and in routes/summary.js's debt total, rather than a Postgres
 * view — the app doesn't use views anywhere else, and one formula
 * duplicated in two places (both commented to point at each other) is
 * simpler than introducing a new kind of database object for it.
 */
/**
 * Every SQL fragment below is a function of `asOf` (a SQL date
 * expression, e.g. `CURRENT_DATE` or a bound `$1::date`) rather than
 * a fixed string hardcoding `CURRENT_DATE` — so the exact same three-
 * source logic can answer either "what does this loan owe right now"
 * (this file's own list endpoint) or "what did it owe as of a given
 * month" (routes/summary.js's Overview card, month-scoped). Nothing
 * about the three sources themselves changes: same statement-first,
 * formula-second, manual-fallback order either way.
 */
const latestStatementBalanceSql = (asOf) => `(
  SELECT st.closing_balance_cents FROM statement st
   WHERE st.account_id = linked_account_id AND st.period_end <= ${asOf}
   ORDER BY st.period_end DESC LIMIT 1
)`;

const hasLinkedStatementSql = (asOf) => `(
  linked_account_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM statement st WHERE st.account_id = linked_account_id AND st.period_end <= ${asOf})
)`;

/**
 * Money out that pays a loan's lender (D196, D299): its merchant or
 * description names the lender, whatever it's categorised ("Consulting
 * Fee" purchases count), on any account, so a loan moved to another
 * account keeps its old payments. Card bills and moves between the
 * household's own accounts are left out, so a lender named like a bank
 * can't pick up its card payments. Plain substring (strpos), not ILIKE,
 * so a % or _ in a lender's name can't widen the match. `t` is the
 * transaction alias; the loan's own columns are read unqualified.
 */
export const lenderPaymentSql = (t = 't') => `
  ${t}.amount_cents < 0
  AND COALESCE(${t}.txn_type, '') NOT IN ('transfer', 'savings')
  AND COALESCE((SELECT c.name FROM category c WHERE c.id = ${t}.category_id), '') <> 'Card Payment'
  AND (strpos(lower(COALESCE(${t}.merchant, '')), lower(trim(lender))) > 0
    OR strpos(lower(${t}.description), lower(trim(lender))) > 0)`;

/**
 * Payments made by `asOf` (D299): what's been paid to the lender since a
 * little before the start, ÷ the monthly payment, never past the term.
 * Counting payments rather than months is what lets a skipped one show:
 * the balance stays up instead of falling with the calendar.
 */
const paymentsMadeSql = (asOf) => `LEAST(term_months, FLOOR((
  SELECT COALESCE(-SUM(tp.amount_cents), 0) FROM transaction tp
   WHERE ${lenderPaymentSql('tp')}
     AND tp.posted_date >= start_date - 10 AND tp.posted_date <= ${asOf}
)::numeric / monthly_payment_cents))::int`;

/** A lender to look payments up by; without one, the old count of months since the start stands in. */
const hasLenderSql = `NULLIF(trim(COALESCE(lender, '')), '') IS NOT NULL`;
const paymentsCountedSql = (asOf) => `CASE WHEN ${hasLenderSql} THEN ${paymentsMadeSql(asOf)} ELSE ${monthsElapsedSql(asOf)} END`;

export const effectiveBalanceSql = (asOf = 'CURRENT_DATE') => `
  CASE
    WHEN ${hasLinkedStatementSql(asOf)} THEN ${latestStatementBalanceSql(asOf)}
    WHEN monthly_payment_cents IS NOT NULL AND term_months IS NOT NULL AND start_date IS NOT NULL
    THEN monthly_payment_cents * GREATEST(term_months - ${paymentsCountedSql(asOf)}, 0)
    ELSE current_balance_cents
  END`;

/** For the UI: which of the three sources above actually produced the number, and as-of when. */
export const balanceSourceSql = (asOf = 'CURRENT_DATE') => `
  CASE
    WHEN ${hasLinkedStatementSql(asOf)} THEN 'statement'
    WHEN monthly_payment_cents IS NOT NULL AND term_months IS NOT NULL AND start_date IS NOT NULL THEN 'formula'
    ELSE 'manual'
  END`;

const balanceAsOfSql = (asOf) => `(
  SELECT st.period_end FROM statement st
   WHERE st.account_id = linked_account_id AND st.period_end <= ${asOf}
   ORDER BY st.period_end DESC LIMIT 1
)`;

const monthsElapsedSql = (asOf) => `
  (EXTRACT(YEAR FROM age(${asOf}, start_date)) * 12
 + EXTRACT(MONTH FROM age(${asOf}, start_date)))::int`;

/**
 * "The end of the given month" (a bound `$N::date` month-start
 * parameter), capped at today. Shared by this file's own list
 * endpoint (when `?month=` is given) and routes/summary.js's Overview
 * card — one formula, so "as of this month" can never mean two
 * slightly different dates depending which screen asked. Never
 * projects into the future: picking a month past today just reads as
 * today, since predicting a payoff balance would be forecasting.
 */
export const monthEndCappedSql = (monthParam) =>
  `LEAST((${monthParam}::date + interval '1 month' - interval '1 day')::date, CURRENT_DATE)`;


/**
 * Everything balance-transfer.js reads about some cards, up to `today`
 * ('YYYY-MM-DD'): their statements (oldest first), promo lines by
 * statement period, and rows. Shared by the status and the suggestions.
 */
async function loadCardFacts(ids, today) {
  const facts = new Map(ids.map((id) => [id, { statements: [], promos: {}, rows: [] }]));
  if (ids.length === 0) return facts;
  const [statements, promos, txns] = await Promise.all([
    query(
      `SELECT account_id, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
              closing_balance_cents, total_payments_cents, minimum_payment_cents
         FROM statement WHERE account_id = ANY($1) AND period_end <= $2::date ORDER BY period_end`,
      [ids, today]
    ),
    query(
      `SELECT s.account_id, to_char(s.period_end, 'YYYY-MM-DD') AS period_end, p.kind, p.label, p.offer_id, p.apr_bps,
              p.standard_apr_bps, to_char(p.end_date, 'YYYY-MM-DD') AS end_date, p.balance_subject_cents
         FROM statement_promo p JOIN statement s ON s.id = p.statement_id
        WHERE s.account_id = ANY($1) AND s.period_end <= $2::date ORDER BY p.id`,
      [ids, today]
    ),
    query(
      `SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.description, t.amount_cents,
              t.txn_type, c.name AS category_name
         FROM transaction t LEFT JOIN category c ON c.id = t.category_id
        WHERE t.account_id = ANY($1) AND t.posted_date <= $2::date`,
      [ids, today]
    ),
  ]);
  for (const { account_id, ...s } of statements.rows) facts.get(account_id).statements.push(s);
  for (const { account_id, period_end, ...p } of promos.rows) (facts.get(account_id).promos[period_end] ??= []).push(p);
  for (const t of txns.rows) facts.get(t.account_id).rows.push(t);
  return facts;
}

const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);

/**
 * D193: a balance-transfer loan's status, from its linked card's own
 * statements, promo lines and rows up to `asOf` (balance-transfer.js).
 * An unlinked one still gets a status from its hand-entered balance and
 * deadline. Attached as `bt`; every other loan gets null.
 */
export async function attachBalanceTransferStatus(loans, asOf = 'CURRENT_DATE', params = []) {
  if (!loans.some((l) => l.loan_type === 'balance_transfer')) return loans.map((l) => ({ ...l, bt: null }));
  const { rows: [{ today }] } = await query(`SELECT to_char(${asOf}, 'YYYY-MM-DD') AS today`, params);
  const ids = [...new Set(loans.filter((l) => l.loan_type === 'balance_transfer' && l.linked_account_id).map((l) => l.linked_account_id))];
  const facts = await loadCardFacts(ids, today);
  return loans.map((l) => {
    if (l.loan_type !== 'balance_transfer') return { ...l, bt: null };
    const card = facts.get(l.linked_account_id) ?? { statements: [], promos: {}, rows: [] };
    return {
      ...l,
      bt: balanceTransferStatus({
        loan: {
          start_date: isoDate(l.start_date), deadline_date: isoDate(l.deadline_date), effective_balance_cents: l.effective_balance_cents,
          // A closed loan ends at its deadline: the card's later transfers are another loan's (D308).
          until: l.is_active === false ? isoDate(l.deadline_date) : null,
          minimum_until: isoDate(l.minimum_until),
        },
        ...card,
        today,
      }),
    };
  });
}

/**
 * D299: a scheduled loan's payments as found (money/loan-payments.js): the
 * money out for its lender up to `asOf`, and how far its paying account's
 * records reach (latest statement or row), which is what tells a missed
 * payment from one not on file yet. Without a paying account nothing is
 * called missed. Attached as `payments`; null for a loan without a full
 * schedule and a lender.
 */
export async function attachPaymentStatus(loans, asOf = 'CURRENT_DATE', params = []) {
  const scheduled = loans.filter((l) => l.monthly_payment_cents && l.term_months && l.start_date && l.lender?.trim() && !l.linked_account_id);
  if (scheduled.length === 0) return loans.map((l) => ({ ...l, payments: null }));
  const { rows: [{ today }] } = await query(`SELECT to_char(${asOf}, 'YYYY-MM-DD') AS today`, params);
  const ids = scheduled.map((l) => l.id);
  const at = params.length + 1;
  const { rows: found } = await query(
    `SELECT loan.id AS loan_id, to_char(tp.posted_date, 'YYYY-MM-DD') AS posted_date, -tp.amount_cents AS cents, tp.account_id
       FROM loan JOIN transaction tp ON ${lenderPaymentSql('tp')}
      WHERE loan.id = ANY($${at}) AND tp.posted_date >= loan.start_date - 10 AND tp.posted_date <= ${asOf}`,
    [...params, ids]
  );
  const accounts = [...new Set(scheduled.map((l) => l.payment_account_id).filter(Boolean))];
  const { rows: reach } = accounts.length === 0 ? { rows: [] } : await query(
    `SELECT a.id, to_char(LEAST(GREATEST(
              (SELECT MAX(period_end) FROM statement s WHERE s.account_id = a.id),
              (SELECT MAX(posted_date) FROM transaction t WHERE t.account_id = a.id)), ${asOf}), 'YYYY-MM-DD') AS covered
       FROM account a WHERE a.id = ANY($${params.length + 1})`,
    [...params, accounts]
  );
  const covered = new Map(reach.map((r) => [r.id, r.covered]));
  return loans.map((l) => {
    if (!ids.includes(l.id)) return { ...l, payments: null };
    return {
      ...l,
      payments: loanPaymentStatus({
        loan: { start_date: isoDate(l.start_date), term_months: l.term_months, monthly_payment_cents: l.monthly_payment_cents },
        payments: found.filter((p) => p.loan_id === l.id).map(({ loan_id: _, ...p }) => p),
        coveredThrough: l.payment_account_id ? covered.get(l.payment_account_id) ?? null : null,
        today,
      }),
    };
  });
}

/* ------------------------------------------------------------------
   Suggestions (D194) — cards carrying a balance transfer with no loan
   tracking it. Dismissals live in app_setting, keyed per promo, so a
   later transfer on the same card is suggested afresh.
   ------------------------------------------------------------------ */

const DISMISSED_KEY = 'dismissed_bt_suggestions';

async function dismissedSuggestions() {
  const { rows } = await query('SELECT value FROM app_setting WHERE key = $1', [DISMISSED_KEY]);
  return Array.isArray(rows[0]?.value) ? rows[0].value : [];
}

loansRouter.get('/suggestions', async (req, res, next) => {
  try {
    const { rows: cards } = await query(
      `SELECT id, name, issuer FROM account WHERE account_type = 'CREDIT_CARD' AND is_active = true ORDER BY id`
    );
    const { rows: loans } = await query('SELECT loan_type, linked_account_id, is_active FROM loan');
    const { rows: [{ today }] } = await query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);
    const facts = await loadCardFacts(cards.map((c) => c.id), today);
    const dismissed = await dismissedSuggestions();
    const transfers = balanceTransferSuggestions({
      cards: cards.map((c) => ({ ...c, ...facts.get(c.id) })),
      loans,
      dismissed,
      today,
    }).map((s) => ({ kind: 'balance_transfer', ...s }));
    // Loans paid from the bank every month that nobody entered (D419): a car loan's auto draft.
    const { rows: bank } = await query(
      `SELECT t.account_id, a.name AS account_name, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents,
              t.description, t.merchant, t.txn_type, c.name AS category_name,
              EXISTS (SELECT 1 FROM payment_match_part pp WHERE pp.transaction_id = t.id) AS card_payment
         FROM transaction t JOIN account a ON a.id = t.account_id LEFT JOIN category c ON c.id = t.category_id
        WHERE a.account_type IN ('CHECKING', 'SAVINGS') AND t.amount_cents < 0`
    );
    const { rows: tracked } = await query('SELECT lender, monthly_payment_cents, payment_account_id FROM loan');
    // Stopped is measured against the latest bank row, so records that end early don't hide a loan.
    const latest = bank.reduce((m, r) => (r.posted_date > m ? r.posted_date : m), '');
    const installments = installmentSuggestions({ rows: bank, loans: tracked, dismissed, today: latest && latest < today ? latest : today });
    res.json([...transfers, ...installments]);
  } catch (err) {
    next(err);
  }
});

loansRouter.post('/suggestions/:key/dismiss', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!/^(\d+:\d{4}-\d{2}-\d{2}|pay:\d+:\d+)$/.test(key)) return res.status(400).json({ error: 'Invalid suggestion key' });
    const dismissed = await dismissedSuggestions();
    if (!dismissed.includes(key)) {
      await query(
        `INSERT INTO app_setting (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [DISMISSED_KEY, JSON.stringify([...dismissed, key])]
      );
      const accountId = Number(key.startsWith('pay:') ? key.split(':')[1] : key.split(':')[0]);
      await audit({ action: 'loan.suggestion_dismissed', entityType: 'account', entityId: accountId, detail: { key } });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   List
   ------------------------------------------------------------------ */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

loansRouter.get('/', async (req, res, next) => {
  try {
    const includeClosed = req.query.include_closed === 'true';

    // Optional — the Overview Loans card's drill-down (LoansDetail.jsx)
    // passes the same month the card itself is showing, so opening it
    // from a past period doesn't suddenly show today's numbers instead
    // of the ones that made the card say what it said. Omitted (the
    // Settings > Loans management page's own use), this is exactly the
    // old "right now" behavior — same SQL fragments, `asOf` defaults
    // to CURRENT_DATE either way.
    const month = req.query.month;
    if (month !== undefined && !MONTH_RE.test(month)) {
      return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    }
    const asOf = month ? monthEndCappedSql('$1') : 'CURRENT_DATE';
    const params = month ? [`${month}-01`] : [];

    const { rows } = await query(
      `SELECT l.id, l.name, l.lender, l.loan_type, l.linked_account_id, l.term_months,
              l.start_date, l.monthly_payment_cents, l.current_balance_cents,
              ${effectiveBalanceSql(asOf)} AS effective_balance_cents,
              ${balanceSourceSql(asOf)} AS balance_source,
              ${balanceAsOfSql(asOf)} AS balance_as_of,
              CASE WHEN l.monthly_payment_cents IS NOT NULL AND l.term_months IS NOT NULL AND l.start_date IS NOT NULL
                THEN GREATEST(l.term_months - ${paymentsCountedSql(asOf)}, 0)
                ELSE NULL
              END AS months_remaining,
              l.deadline_date, l.is_active, l.created_at, l.updated_at, to_char(l.minimum_until, 'YYYY-MM-DD') AS minimum_until,
              a.name AS linked_account_name,
              l.payment_account_id, pa.name AS payment_account_name, pa.mask AS payment_account_mask
         FROM loan l
         LEFT JOIN account a ON a.id = l.linked_account_id
         LEFT JOIN account pa ON pa.id = l.payment_account_id
        WHERE ${includeClosed ? 'true' : 'l.is_active = true'}
          ${month ? `AND (l.start_date IS NULL OR l.start_date <= ${asOf})` : ''}
        ORDER BY l.deadline_date ASC NULLS LAST, l.name`,
      params
    );

    // A closed loan keeps the balance it closed with (D308): the linked card's
    // statements after that are its later borrowing, another loan's.
    const settled = rows.map((l) => (l.is_active ? l : { ...l, effective_balance_cents: l.current_balance_cents, balance_source: 'manual', balance_as_of: null }));
    res.json(await attachPaymentStatus(await attachBalanceTransferStatus(settled, asOf, params), asOf, params));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   History — the per-loan drill-down: one row per month, from the
   loan's start (or its first linked statement, or when it was added)
   through the current month.

   remaining: the same three-source balance as everywhere else
     (effectiveBalanceSql), evaluated at each month's end. No new
     maths — no amortization, no interest.
   paid: only what can actually be read, never inferred.
     - linked to a card: the payments the issuer printed on that
       month's statement (statement.total_payments_cents), same
       "read it off the statement" rule as cashback;
     - otherwise, with a lender: money out whose merchant or
       description contains the lender's name ("WELLS FARGO AUTO
       DRAFT" for lender "Wells Fargo"), whatever it's categorised —
       a household may file them as, say, "Consulting Fee" purchases, and
       requiring the Loan category missed them all (D196). Card bills
       and moves between your own accounts are left out, so a lender
       named like a bank can't pick up its card payments. Plain
       substring (strpos), not ILIKE, so a % or _ in a lender's name
       can't widen the match;
     - neither: null — the UI says it can't tell, rather than guessing.
   records_from: the first month the app has anything to read payments
     from (the linked card's first statement, or the first transaction
     at all). A month before it isn't "no payment", it's "no records".
   ------------------------------------------------------------------ */

const MAX_HISTORY_MONTHS = 120;

loansRouter.get('/:id/history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid loan id' });

    const { rows: found } = await query('SELECT id, name, linked_account_id, lender FROM loan WHERE id = $1', [id]);
    if (found.length === 0) return res.status(404).json({ error: 'Loan not found' });
    const loan = found[0];
    const paidSource = loan.linked_account_id ? 'statement' : loan.lender?.trim() ? 'lender_match' : null;

    const monthEnd = `LEAST((m + interval '1 month' - interval '1 day')::date, CURRENT_DATE)`;
    const paidSql = {
      statement: `(SELECT COALESCE(SUM(s.total_payments_cents), 0) FROM statement s
                    WHERE s.account_id = loan.linked_account_id AND date_trunc('month', s.period_end) = m)`,
      lender_match: `(SELECT COALESCE(-SUM(t.amount_cents), 0) FROM transaction t
                      WHERE ${lenderPaymentSql('t')} AND date_trunc('month', t.posted_date) = m)`,
    }[paidSource] ?? 'NULL';

    const { rows } = await query(
      `WITH bounds AS (
         SELECT date_trunc('month', COALESCE(
                  start_date,
                  (SELECT MIN(period_end) FROM statement WHERE account_id = loan.linked_account_id),
                  created_at::date))::date AS first_month
           FROM loan WHERE id = $1
       ),
       months AS (
         SELECT generate_series(
                  GREATEST(first_month, date_trunc('month', CURRENT_DATE) - interval '${MAX_HISTORY_MONTHS - 1} months'),
                  date_trunc('month', CURRENT_DATE),
                  interval '1 month')::date AS m
           FROM bounds
       )
       SELECT to_char(m, 'YYYY-MM') AS month,
              ${paidSql}::int AS paid_cents,
              (${effectiveBalanceSql(monthEnd)})::int AS remaining_cents,
              ${balanceSourceSql(monthEnd)} AS balance_source
         FROM months CROSS JOIN loan
        WHERE loan.id = $1
        ORDER BY m`,
      [id]
    );

    const recordsFromSql = {
      statement: [`SELECT to_char(MIN(period_end), 'YYYY-MM') AS m FROM statement WHERE account_id = $1`, [loan.linked_account_id]],
      lender_match: [`SELECT to_char(MIN(posted_date), 'YYYY-MM') AS m FROM transaction`, []],
    }[paidSource];
    const recordsFrom = recordsFromSql ? (await query(...recordsFromSql)).rows[0].m : null;

    res.json({
      loan_id: id,
      paid_source: paidSource,
      records_from: recordsFrom,
      total_paid_cents: paidSource ? rows.reduce((sum, r) => sum + (r.paid_cents ?? 0), 0) : null,
      months: rows,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Create
   ------------------------------------------------------------------ */

loansRouter.post('/', validate(loanCreateSchema), async (req, res, next) => {
  try {
    const {
      name,
      lender,
      loan_type,
      linked_account_id,
      term_months,
      start_date,
      monthly_payment_cents,
      current_balance_cents,
      deadline_date,
      payment_account_id,
    } = req.body;

    if (payment_account_id !== undefined) {
      const { rows: found } = await query('SELECT id FROM account WHERE id = $1', [payment_account_id]);
      if (found.length === 0) return res.status(400).json({ error: 'That account does not exist', field: 'payment_account_id' });
    }

    if (linked_account_id !== undefined) {
      const check = await assertLinkableAccount(linked_account_id);
      if (!check.ok) return res.status(400).json({ error: check.error, field: 'linked_account_id' });
    }

    const { rows } = await query(
      `INSERT INTO loan (name, lender, loan_type, linked_account_id, term_months, start_date, monthly_payment_cents, current_balance_cents, deadline_date, payment_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, lender, loan_type, linked_account_id, term_months, start_date, monthly_payment_cents, current_balance_cents, deadline_date, is_active, payment_account_id, minimum_until`,
      [
        name,
        orNull(lender),
        loan_type ?? 'other',
        orNull(linked_account_id),
        orNull(term_months),
        orNull(start_date),
        orNull(monthly_payment_cents),
        current_balance_cents,
        orNull(deadline_date),
        orNull(payment_account_id),
      ]
    );

    const loan = rows[0];

    await audit({
      action: 'loan.created',
      entityType: 'loan',
      entityId: loan.id,
      detail: { name: loan.name, current_balance_cents },
    });

    res.status(201).json(loan);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Update — balance and deadline change most often, but every field
   is editable, same fixed-allow-list PATCH pattern as accounts.
   ------------------------------------------------------------------ */

loansRouter.patch('/:id', validate(loanUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT * FROM loan WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (req.body.payment_account_id != null) {
      const { rows: found } = await query('SELECT id FROM account WHERE id = $1', [req.body.payment_account_id]);
      if (found.length === 0) return res.status(400).json({ error: 'That account does not exist', field: 'payment_account_id' });
    }

    if (req.body.linked_account_id != null) {
      const check = await assertLinkableAccount(req.body.linked_account_id);
      if (!check.ok) return res.status(400).json({ error: check.error, field: 'linked_account_id' });
    }

    const allowed = [
      'name',
      'lender',
      'loan_type',
      'linked_account_id',
      'term_months',
      'start_date',
      'monthly_payment_cents',
      'current_balance_cents',
      'deadline_date',
      'is_active',
      'payment_account_id',
      'minimum_until',
    ];
    const sets = [];
    const values = [];

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(orNull(req.body[field]));
        sets.push(`${field} = $${values.length}`);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(id);

    const { rows } = await query(
      `UPDATE loan SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING id, name, lender, loan_type, linked_account_id, term_months, start_date, monthly_payment_cents, current_balance_cents, deadline_date, is_active, payment_account_id, minimum_until`,
      values
    );

    await audit({
      action: 'loan.updated',
      entityType: 'loan',
      entityId: id,
      detail: { changed: Object.keys(req.body), changes: changesBetween(existing[0], rows[0], Object.keys(req.body)) },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Deactivate — no hard delete, same rule as accounts. A paid-off or
   closed loan is still part of the household's financial history.
   ------------------------------------------------------------------ */

loansRouter.post('/:id/deactivate', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows } = await query(
      `UPDATE loan SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id, name`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Loan not found' });

    await audit({ action: 'loan.deactivated', entityType: 'loan', entityId: id, detail: { name: rows[0].name } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
