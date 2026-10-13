/**
 * Recurring bills (D185). Built on bills.js, which holds every rule; this
 * file only reads and writes.
 *
 *   GET    /api/recurring                      live bills, each with status and history
 *   GET    /api/recurring/suggestions          what looks like a bill and isn't one yet
 *   POST   /api/recurring/suggestions/ignore   { key }  never suggest that one again
 *   POST   /api/recurring                      confirm a suggestion (or add one by hand)
 *   PATCH  /api/recurring/:id                  name, price, rhythm, day, pause/end/resume
 *   GET    /api/recurring/:id/charges          the charges linked to a bill
 *   POST   /api/recurring/:id/unlink           { transaction_id }  "that one isn't this bill"
 *
 * A bill's next date and status are computed from its own charges on
 * every read, never trusted from a stored column (the stored ones are
 * kept in step for anything that reads the table directly).
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { audit } from '../audit.js';
import { changesBetween } from '../changes.js';
import { validate, billCreateSchema, billUpdateSchema, billIgnoreSchema, billUnlinkSchema } from '../validate.js';
import { detect, matchBill, billStatus, monthView, suggestionKey } from '../bills.js';
import { spendSql } from '../spend.js';

export const recurringRouter = Router();

const today = () => new Date().toLocaleDateString('en-CA');

// Spending, plus loan payments (a car loan is a bill even though it isn't "spend").
const BILL_ROWS_SQL = `(${spendSql('t')} OR (cat.name = 'Loan' AND t.txn_type = 'payment'))`;

/** Keep the stored bookkeeping columns in step with the bill's real charges. */
async function sync(client, id) {
  const { rows: [bill] } = await client.query('SELECT * FROM recurring_series WHERE id = $1', [id]);
  const { rows: charges } = await client.query(
    'SELECT posted_date::text AS posted_date FROM transaction WHERE recurring_series_id = $1 ORDER BY posted_date',
    [id]
  );
  const st = billStatus(bill, charges, today());
  await client.query(
    `UPDATE recurring_series
        SET occurrence_count = $2, first_seen_date = $3, last_seen_date = $4, next_expected_date = $5, updated_at = now()
      WHERE id = $1`,
    [id, charges.length, charges[0]?.posted_date ?? null, st.last_date, st.next_date]
  );
}

/** Link these charges to a bill, audited one by one. */
async function link(client, bill, charges) {
  for (const t of charges) {
    await client.query('UPDATE transaction SET recurring_series_id = $1 WHERE id = $2', [bill.id, t.id]);
    await audit({
      action: 'recurring.linked',
      entityType: 'transaction',
      entityId: t.id,
      detail: { recurring_series_id: bill.id, series_name: bill.name, amount_cents: t.amount_cents },
    });
  }
}

/**
 * After an import is approved (routes/imports.js): each new charge goes to
 * the live bill it belongs to, if any. Runs in the approval's own
 * transaction, so a half-linked state never commits.
 */
export async function matchNewTransactions(transactionIds, client) {
  if (transactionIds.length === 0) return;
  const { rows: txns } = await client.query(
    `SELECT id, posted_date::text AS posted_date, amount_cents, merchant
       FROM transaction WHERE id = ANY($1) AND recurring_series_id IS NULL`,
    [transactionIds]
  );
  const { rows: bills } = await client.query(`SELECT * FROM recurring_series WHERE status IN ('ACTIVE', 'PAUSED')`);
  const touched = new Set();
  for (const t of txns) {
    const bill = matchBill(t, bills);
    if (!bill) continue;
    await link(client, bill, [t]);
    touched.add(bill.id);
  }
  for (const id of touched) await sync(client, id);
}

/** Every suggestion, minus the ignored ones. Shared with the alerts. */
export async function getSuggestions() {
  const { rows: txns } = await query(
    `SELECT t.id, t.posted_date::text AS posted_date, t.amount_cents, t.merchant, t.description, t.account_id
       FROM transaction t LEFT JOIN category cat ON cat.id = t.category_id
      WHERE t.amount_cents < 0 AND ${BILL_ROWS_SQL} AND t.posted_date >= CURRENT_DATE - INTERVAL '2 years'`
  );
  const { rows: bills } = await query(`SELECT * FROM recurring_series WHERE status <> 'ARCHIVED'`);
  const { rows: ignored } = await query('SELECT match_name_contains FROM dismissed_recurring_candidate');
  return detect(txns, bills, { today: today(), ignored: new Set(ignored.map((r) => r.match_name_contains.toLowerCase())) })
    .map((sug) => ({ ...sug, key: suggestionKey(sug) }));
}

/** Live bills with their status (and, given a 'YYYY-MM', that month's view). Shared with the alerts. */
export async function getBills({ includeEnded = false, month = null } = {}) {
  const { rows: bills } = await query(
    `SELECT * FROM recurring_series WHERE status IN ('ACTIVE', 'PAUSED'${includeEnded ? ", 'ENDED'" : ''}) ORDER BY name`
  );
  const { rows: charges } = await query(
    `SELECT id, recurring_series_id, posted_date::text AS posted_date, amount_cents
       FROM transaction WHERE recurring_series_id = ANY($1) ORDER BY posted_date`,
    [bills.map((b) => b.id)]
  );
  const t = today();
  return bills.map((b) => {
    const own = charges.filter((c) => c.recurring_series_id === b.id);
    return { ...b, ...billStatus(b, own, t), charge_count: own.length, ...(month ? { month: monthView(b, own, month, t) } : {}) };
  });
}

recurringRouter.get('/', async (req, res, next) => {
  try {
    const month = typeof req.query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : null;
    if (req.query.month !== undefined && !month) return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    res.json(await getBills({ includeEnded: req.query.include_ended === 'true', month }));
  } catch (err) {
    next(err);
  }
});

recurringRouter.get('/suggestions', async (req, res, next) => {
  try {
    res.json(await getSuggestions());
  } catch (err) {
    next(err);
  }
});

recurringRouter.post('/suggestions/ignore', validate(billIgnoreSchema), async (req, res, next) => {
  try {
    const key = req.body.key.toLowerCase();
    await query('INSERT INTO dismissed_recurring_candidate (match_name_contains) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
    await audit({ action: 'recurring.suggestion_ignored', detail: { key } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

recurringRouter.post('/', validate(billCreateSchema), async (req, res, next) => {
  try {
    const b = req.body;
    const bill = await withTransaction(async (client) => {
      const n = b.charge_ids.length;
      const { rows: [created] } = await client.query(
        `INSERT INTO recurring_series
           (name, glyph, match_name_contains, cadence, match_days_of_month, expected_amount_cents, amount_varies,
            match_amount_min_cents, match_amount_max_cents, status, confidence, created_from)
         VALUES ($1, '', $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10)
         RETURNING *`,
        [
          b.name, b.merchant, b.cadence, b.day ? [b.day] : null, b.expected_amount_cents, b.amount_varies,
          b.amount_varies ? b.match_amount_min_cents ?? null : null, b.amount_varies ? b.match_amount_max_cents ?? null : null,
          n >= 5 ? 'HIGH' : n >= 3 ? 'MEDIUM' : 'LOW', n > 0 ? 'DETECTED' : 'MANUAL',
        ]
      );
      // The suggestion's own charges, plus any other unclaimed charge this bill accepts.
      const { rows: txns } = await client.query(
        `SELECT id, posted_date::text AS posted_date, amount_cents, merchant
           FROM transaction WHERE recurring_series_id IS NULL AND (id = ANY($1) OR lower(merchant) = lower($2))`,
        [b.charge_ids, b.merchant]
      );
      await link(client, created, txns.filter((t) => b.charge_ids.includes(t.id) || matchBill(t, [created])));
      await sync(client, created.id);
      return created;
    });
    await audit({
      action: 'recurring.created',
      entityType: 'recurring_series',
      entityId: bill.id,
      detail: { name: bill.name, cadence: bill.cadence, expected_amount_cents: bill.expected_amount_cents },
    });
    res.status(201).json(bill);
  } catch (err) {
    next(err);
  }
});

recurringRouter.patch('/:id', validate(billUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: [before] } = await query(`SELECT * FROM recurring_series WHERE id = $1 AND status <> 'ARCHIVED'`, [id]);
    if (!before) return res.status(404).json({ error: 'Bill not found' });

    // Column names come from this fixed list only, never from the request.
    const COLUMNS = ['name', 'cadence', 'expected_amount_cents', 'amount_varies', 'status'];
    const sets = [];
    const values = [id];
    for (const col of COLUMNS) {
      if (req.body[col] === undefined) continue;
      values.push(req.body[col]);
      sets.push(`${col} = $${values.length}`);
    }
    if (req.body.day !== undefined) {
      values.push(req.body.day ? [req.body.day] : null);
      sets.push(`match_days_of_month = $${values.length}`);
    }
    const after = await withTransaction(async (client) => {
      await client.query(`UPDATE recurring_series SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
      await sync(client, id);
      return (await client.query('SELECT * FROM recurring_series WHERE id = $1', [id])).rows[0];
    });
    await audit({
      action: 'recurring.updated',
      entityType: 'recurring_series',
      entityId: id,
      detail: { changes: changesBetween(before, after, [...COLUMNS, 'match_days_of_month']) },
    });
    res.json(after);
  } catch (err) {
    next(err);
  }
});

recurringRouter.get('/:id/charges', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.posted_date::text AS posted_date, t.amount_cents, t.description, a.name AS account_name
         FROM transaction t JOIN account a ON a.id = t.account_id
        WHERE t.recurring_series_id = $1 ORDER BY t.posted_date DESC`,
      [Number(req.params.id)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

recurringRouter.post('/:id/unlink', validate(billUnlinkSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const done = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        'UPDATE transaction SET recurring_series_id = NULL WHERE id = $1 AND recurring_series_id = $2',
        [req.body.transaction_id, id]
      );
      if (rowCount === 0) return false;
      await sync(client, id);
      return true;
    });
    if (!done) return res.status(404).json({ error: 'That charge is not linked to this bill' });
    await audit({ action: 'recurring.unlinked', entityType: 'transaction', entityId: req.body.transaction_id, detail: { recurring_series_id: id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
