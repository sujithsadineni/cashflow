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
import { query } from '../db.js';
import { audit } from '../audit.js';
import { changesBetween } from '../changes.js';
import { validate, loanCreateSchema, loanUpdateSchema } from '../validate.js';

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

export const effectiveBalanceSql = (asOf = 'CURRENT_DATE') => `
  CASE
    WHEN ${hasLinkedStatementSql(asOf)} THEN ${latestStatementBalanceSql(asOf)}
    WHEN monthly_payment_cents IS NOT NULL AND term_months IS NOT NULL AND start_date IS NOT NULL
    THEN monthly_payment_cents * GREATEST(
      term_months - (EXTRACT(YEAR FROM age(${asOf}, start_date)) * 12
                    + EXTRACT(MONTH FROM age(${asOf}, start_date)))::int,
      0)
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
                THEN GREATEST(l.term_months - ${monthsElapsedSql(asOf)}, 0)
                ELSE NULL
              END AS months_remaining,
              l.deadline_date, l.is_active, l.created_at,
              a.name AS linked_account_name
         FROM loan l
         LEFT JOIN account a ON a.id = l.linked_account_id
        WHERE ${includeClosed ? 'true' : 'l.is_active = true'}
          ${month ? `AND (l.start_date IS NULL OR l.start_date <= ${asOf})` : ''}
        ORDER BY l.deadline_date ASC NULLS LAST, l.name`,
      params
    );

    res.json(rows);
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
     - otherwise, with a lender: Loan-category payment transactions
       whose merchant or description contains the lender's name
       ("WELLS FARGO AUTO DRAFT" for lender "Wells Fargo"). Plain
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
                       JOIN category c ON c.id = t.category_id
                      WHERE c.name = 'Loan' AND t.txn_type = 'payment'
                        AND date_trunc('month', t.posted_date) = m
                        AND (strpos(lower(COALESCE(t.merchant, '')), lower(trim(loan.lender))) > 0
                          OR strpos(lower(t.description), lower(trim(loan.lender))) > 0))`,
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
    } = req.body;

    if (linked_account_id !== undefined) {
      const check = await assertLinkableAccount(linked_account_id);
      if (!check.ok) return res.status(400).json({ error: check.error, field: 'linked_account_id' });
    }

    const { rows } = await query(
      `INSERT INTO loan (name, lender, loan_type, linked_account_id, term_months, start_date, monthly_payment_cents, current_balance_cents, deadline_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, lender, loan_type, linked_account_id, term_months, start_date, monthly_payment_cents, current_balance_cents, deadline_date, is_active`,
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
        RETURNING id, name, lender, loan_type, linked_account_id, term_months, start_date, monthly_payment_cents, current_balance_cents, deadline_date, is_active`,
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
