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
import { query, withTransaction } from '../core/db.js';
import { audit } from '../core/audit.js';
import { changesBetween } from '../core/changes.js';
import { validate, billCreateSchema, billUpdateSchema, billIgnoreSchema, billUnlinkSchema } from '../core/validate.js';
import { detect, matchBill, PASSES, acceptsAmount, billStatus, monthView, suggestionKey } from '../money/bills.js';
import { spendSql } from '../money/spend.js';

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
      // price_changed: linked at a new price on the bill's day (D364).
      detail: { recurring_series_id: bill.id, series_name: bill.name, amount_cents: t.amount_cents, ...(acceptsAmount(bill, t.amount_cents) ? {} : { price_changed: true }) },
    });
  }
}

/**
 * After an import is approved (routes/imports.js): each new charge goes to
 * the live bill it belongs to, if any. Runs in the approval's own
 * transaction, so a half-linked state never commits.
 */
/** Links new rows to the bills they belong to; returns those bills' names (D317). */
export async function matchNewTransactions(transactionIds, client) {
  return (await linkMatches(transactionIds, client)).names;
}

/**
 * Link each unlinked row to the live bill it matches. A charge taken off a
 * bill by hand ("Not this", an audited `recurring.unlinked`) is never put
 * back on that bill (D363). Returns how many rows were linked and the bills' names.
 */
async function linkMatches(transactionIds, client) {
  if (transactionIds.length === 0) return { linked: 0, names: [] };
  const { rows: txns } = await client.query(
    `SELECT id, posted_date::text AS posted_date, amount_cents, merchant
       FROM transaction WHERE id = ANY($1) AND recurring_series_id IS NULL`,
    [transactionIds]
  );
  const { rows: bills } = await client.query(`SELECT * FROM recurring_series WHERE status IN ('ACTIVE', 'PAUSED')`);
  const { rows: unlinked } = await client.query(
    `SELECT entity_id, (detail->>'recurring_series_id')::int AS bill_id
       FROM audit_log WHERE action = 'recurring.unlinked' AND entity_id = ANY($1)`,
    [txns.map((t) => t.id)]
  );
  const refused = new Set(unlinked.map((u) => `${u.entity_id}:${u.bill_id}`));
  // Each bill's linked dates, so a new price is only taken for a cycle not yet paid.
  const { rows: had } = await client.query(
    'SELECT recurring_series_id AS id, posted_date::text AS d FROM transaction WHERE recurring_series_id = ANY($1)',
    [bills.map((b) => b.id)]
  );
  const taken = new Map();
  for (const r of had) taken.set(r.id, [...(taken.get(r.id) ?? []), r.d]);
  const touched = new Set();
  const done = new Set();
  let linked = 0;
  // In rounds (D365): the exact price, then close to it, then a new price; oldest first, and on
  // one day the amount nearest a bill's price first. A cycle's real charge wins over a ticket near it.
  const nearest = (t) => Math.min(...bills.map((b) => Math.abs(b.expected_amount_cents - t.amount_cents)));
  const order = [...txns].sort((a, b) => a.posted_date.localeCompare(b.posted_date) || nearest(a) - nearest(b));
  for (const pass of PASSES) {
    for (const t of order) {
      if (done.has(t.id)) continue;
      const bill = matchBill(t, bills.filter((b) => !refused.has(`${t.id}:${b.id}`)), taken, { pass });
      if (!bill) continue;
      await link(client, bill, [t]);
      taken.set(bill.id, [...(taken.get(bill.id) ?? []), t.posted_date]);
      touched.add(bill.id);
      done.add(t.id);
      linked += 1;
    }
  }
  for (const id of touched) await sync(client, id);
  return { linked, names: bills.filter((b) => touched.has(b.id)).map((b) => b.name) };
}

/** Every suggestion, minus the ignored ones. Shared with the alerts. */
export async function getSuggestions() {
  const { rows: txns } = await query(
    `SELECT t.id, t.posted_date::text AS posted_date, t.amount_cents, t.merchant, t.description, t.account_id, cat.name AS category
       FROM transaction t LEFT JOIN category cat ON cat.id = t.category_id
      WHERE t.amount_cents < 0 AND ${BILL_ROWS_SQL} AND t.posted_date >= CURRENT_DATE - INTERVAL '2 years'`
  );
  const { rows: bills } = await query(`SELECT * FROM recurring_series WHERE status <> 'ARCHIVED'`);
  const { rows: ignored } = await query('SELECT match_name_contains FROM dismissed_recurring_candidate');
  return detect(txns, bills, { today: today(), ignored: new Set(ignored.map((r) => r.match_name_contains.toLowerCase())) })
    .map((sug) => ({ ...sug, key: suggestionKey(sug) }));
}

/**
 * What a bill's own charges say over time (D316): what it cost in the last
 * twelve months, and its latest price change, when the newest charge
 * differs from the one before it by more than a cent and a percent (an
 * exchange-rate wobble isn't a price change). Oldest-first `own`.
 */
export function chargeFacts(own, todayIso) {
  const yearAgo = `${Number(todayIso.slice(0, 4)) - 1}${todayIso.slice(4)}`;
  const year_cents = own.filter((c) => c.posted_date > yearAgo).reduce((s, c) => s + Math.abs(c.amount_cents), 0);
  let price_change = null;
  for (let i = own.length - 1; i > 0; i--) {
    const now = Math.abs(own[i].amount_cents);
    const before = Math.abs(own[i - 1].amount_cents);
    if (Math.abs(now - before) > 1 && Math.abs(now - before) / before > 0.01) {
      // Only the newest change, only if it's the price charged since then, and not
      // a return to the price before one odd charge (that charge was the one-off).
      const backToEarlier = i > 1 && Math.abs(Math.abs(own[i - 2].amount_cents) - now) <= 1;
      if (!backToEarlier && own.slice(i).every((c) => Math.abs(Math.abs(c.amount_cents) - now) <= 1)) {
        price_change = { from_cents: before, to_cents: now, since: own[i].posted_date };
      }
      break;
    }
  }
  // The average a month since the bill was first seen (D365), not over a fixed twelve months:
  // a bill seen for three months is averaged over three.
  const first = own[0]?.posted_date ?? null;
  const last = own.at(-1)?.posted_date ?? null;
  const total_cents = own.reduce((s, c) => s + Math.abs(c.amount_cents), 0);
  const months = first ? (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(last.slice(5, 7)) - Number(first.slice(5, 7)) + 1 : 0;
  return { year_cents, price_change, since: first, total_cents, avg_monthly_cents: months ? Math.round(total_cents / months) : null };
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
    const facts = chargeFacts(own, t);
    // A bill paid by hand has no fixed amount (D368): it's expected at its average a month since it
    // was first seen — what it costs a month, what's due, what the page counts — never its last payment.
    const bill = b.amount_varies && facts.avg_monthly_cents ? { ...b, expected_amount_cents: -facts.avg_monthly_cents } : b;
    const status = billStatus(bill, own, t);
    const varies = b.amount_varies ? { price_change: null } : {};
    return { ...bill, ...status, charge_count: own.length, ...facts, ...varies, ...(month ? { month: monthView(bill, own, month, t) } : {}) };
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

/**
 * Re-check (D363 step 2): link saved charges from the last two years that
 * match a live bill but were approved before it was added or edited, then
 * say how many new bills the statements suggest. One transaction; each link
 * audited as at approval, and one entry for the run.
 */
recurringRouter.post('/recheck', async (req, res, next) => {
  try {
    const { linked, names } = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT t.id FROM transaction t LEFT JOIN category cat ON cat.id = t.category_id
          WHERE t.recurring_series_id IS NULL AND t.amount_cents < 0 AND ${BILL_ROWS_SQL}
            AND t.posted_date >= CURRENT_DATE - INTERVAL '2 years'`
      );
      const result = await linkMatches(rows.map((r) => r.id), client);
      await audit({ action: 'recurring.rechecked', detail: { linked: result.linked, bills: result.names }, client });
      return result;
    });
    res.json({ linked, bills: names, found: (await getSuggestions()).length });
  } catch (err) {
    next(err);
  }
});

/** What's been ignored (D364): `merchant|cadence|price`, or `…|variable`; an old merchant-wide entry is just the merchant. */
recurringRouter.get('/suggestions/ignored', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT match_name_contains AS key, dismissed_at FROM dismissed_recurring_candidate ORDER BY dismissed_at DESC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** Ask about an ignored suggestion again. A preference, not a record, so it's removed; the audit keeps the key. */
recurringRouter.post('/suggestions/restore', validate(billIgnoreSchema), async (req, res, next) => {
  try {
    const key = req.body.key.toLowerCase();
    const { rowCount } = await query('DELETE FROM dismissed_recurring_candidate WHERE lower(match_name_contains) = $1', [key]);
    if (rowCount === 0) return res.status(404).json({ error: 'That suggestion is not ignored' });
    await audit({ action: 'recurring.suggestion_restored', detail: { key } });
    res.json({ ok: true });
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
      // The suggestion's own charges, then any other unclaimed charge of the merchant's the
      // bill accepts, by the same rules as Re-check: on its day, once a cycle (D365).
      const { rows: own } = await client.query(
        `SELECT id, posted_date::text AS posted_date, amount_cents, merchant FROM transaction WHERE recurring_series_id IS NULL AND id = ANY($1)`,
        [b.charge_ids]
      );
      await link(client, created, own);
      const { rows: more } = await client.query(
        'SELECT id FROM transaction WHERE recurring_series_id IS NULL AND lower(merchant) = lower($1)',
        [b.merchant]
      );
      await linkMatches(more.map((r) => r.id), client);
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
