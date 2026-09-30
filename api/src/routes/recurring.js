/**
 * Recurring expenses: detection proposes, the user confirms.
 *
 * POST /detect runs the classifier in recurring.js against real
 * transaction history and returns candidates — nothing is saved.
 * Confirming one (POST /) both creates the series AND immediately
 * links the historical transactions that produced it (its own
 * "evidence"), so confirming a candidate retroactively tags the
 * purchases you just looked at, not only future ones. Every import
 * approval afterward re-runs matching for the newly approved rows
 * (see matchAndLinkSeries, called from routes/imports.js).
 */

import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { audit } from '../audit.js';
import { changesBetween } from '../changes.js';
import { validate, recurringCreateSchema, recurringUpdateSchema, recurringLinkSchema, recurringDismissSchema } from '../validate.js';
import { detectCandidates, matchesRule, addCadence, isLapsed } from '../recurring.js';

export const recurringRouter = Router();

const orNull = (value) => (value === '' || value === undefined ? null : value);

const SELECT_COLUMNS = `
  rs.id, rs.name, rs.glyph, rs.category_id, rs.account_id, rs.person_id,
  rs.match_name_contains, rs.match_amount_min_cents, rs.match_amount_max_cents, rs.match_days_of_month,
  rs.cadence, rs.cadence_interval, rs.expected_amount_cents, rs.amount_varies,
  rs.status, rs.next_expected_date, rs.confidence, rs.created_from,
  rs.first_seen_date, rs.last_seen_date, rs.occurrence_count,
  a.name AS account_name, c.name AS category_name
`;

const withLapsed = (row) => ({
  ...row,
  lapsed: row.status === 'ACTIVE' && isLapsed(row.next_expected_date, row.cadence, row.cadence_interval),
});

/**
 * Link every transaction in `transactions` that matches `series` and
 * isn't already linked, then update the series' own bookkeeping
 * (occurrence_count, last/first_seen_date, next_expected_date) and
 * audit each link. Used both for the initial retroactive link on
 * create and for the post-import-approval matcher.
 */
async function matchAndLinkSeries(series, transactions, client) {
  const matches = transactions.filter((t) => t.recurring_series_id == null && matchesRule(t, series));
  if (matches.length === 0) return 0;

  for (const t of matches) {
    await client.query('UPDATE transaction SET recurring_series_id = $1 WHERE id = $2', [series.id, t.id]);
    await audit({
      action: 'recurring.linked',
      entityType: 'transaction',
      entityId: t.id,
      detail: { recurring_series_id: series.id, series_name: series.name, merchant: t.merchant, amount_cents: t.amount_cents },
    });
  }

  const matchedDates = matches.map((t) => t.posted_date).sort();
  const newLastSeen = [series.last_seen_date, matchedDates[matchedDates.length - 1]].filter(Boolean).sort().pop();
  const newFirstSeen = [series.first_seen_date, matchedDates[0]].filter(Boolean).sort()[0];
  const nextExpected = addCadence(newLastSeen, series.cadence, series.cadence_interval, series.match_days_of_month);

  await client.query(
    `UPDATE recurring_series
        SET occurrence_count = occurrence_count + $2,
            last_seen_date = $3, first_seen_date = $4, next_expected_date = $5,
            updated_at = now()
      WHERE id = $1`,
    [series.id, matches.length, newLastSeen, newFirstSeen, nextExpected]
  );

  return matches.length;
}

/**
 * Called from routes/imports.js after an import is approved: matches
 * the newly-approved transactions against every ACTIVE series. Runs
 * inside the same approval transaction (client is the same one
 * imports.js is already using), so a half-linked state never commits.
 */
export async function matchNewTransactions(transactionIds, client) {
  if (transactionIds.length === 0) return;

  const { rows: transactions } = await client.query(
    `SELECT t.id, t.posted_date::text, t.amount_cents, t.merchant, t.description, t.account_id, t.recurring_series_id, a.person_id
       FROM transaction t JOIN account a ON a.id = t.account_id
      WHERE t.id = ANY($1)`,
    [transactionIds]
  );

  const { rows: series } = await client.query(`SELECT * FROM recurring_series WHERE status = 'ACTIVE'`);

  for (const s of series) {
    await matchAndLinkSeries(s, transactions, client);
  }
}

/* ------------------------------------------------------------------
   Detect — proposes candidates, saves nothing
   ------------------------------------------------------------------ */

/**
 * Shared by the manual "Review detected" button (POST /detect below)
 * and the alerts endpoint (routes/alerts.js) — one place that knows
 * how to run the classifier against real history, so the two never
 * drift into scanning different windows or existing-series sets.
 */
export async function getRecurringCandidates() {
  const { rows: transactions } = await query(
    `SELECT t.id, t.posted_date::text, t.amount_cents, t.merchant, t.description, t.account_id, a.person_id
       FROM transaction t JOIN account a ON a.id = t.account_id
      WHERE t.amount_cents < 0 AND t.posted_date >= CURRENT_DATE - INTERVAL '2 years'`
  );
  // Every existing series, regardless of status — an ENDED one still
  // means "don't propose this merchant as new," see detectCandidates'
  // own docs for why.
  const { rows: existingSeries } = await query(`SELECT * FROM recurring_series`);
  const candidates = detectCandidates(transactions, existingSeries);

  // A dismissed candidate is the same kind of "don't propose this
  // again" as an ENDED series above, just for a merchant nobody ever
  // confirmed — see db/023_dismissed_recurring_candidate.sql.
  const { rows: dismissed } = await query(`SELECT match_name_contains FROM dismissed_recurring_candidate`);
  const dismissedNames = new Set(dismissed.map((d) => d.match_name_contains));
  return candidates.filter((c) => !dismissedNames.has(c.match_name_contains));
}

recurringRouter.post('/detect', async (req, res, next) => {
  try {
    res.json(await getRecurringCandidates());
  } catch (err) {
    next(err);
  }
});

/**
 * Permanent, not a per-session hide — the whole point is that
 * refreshing or re-running detection doesn't bring it back. Only
 * `match_name_contains` is needed: that's the same identity
 * detection itself re-derives every time it runs, so this doesn't
 * need to know anything else about the candidate that proposed it.
 */
recurringRouter.post('/candidates/dismiss', validate(recurringDismissSchema), async (req, res, next) => {
  try {
    const { match_name_contains } = req.body;
    await query(
      `INSERT INTO dismissed_recurring_candidate (match_name_contains) VALUES ($1) ON CONFLICT (match_name_contains) DO NOTHING`,
      [match_name_contains]
    );
    await audit({ action: 'recurring.candidate_dismissed', entityType: 'recurring_candidate', detail: { match_name_contains } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   List
   ------------------------------------------------------------------ */

recurringRouter.get('/', async (req, res, next) => {
  try {
    const includeEnded = req.query.include_ended === 'true';

    const { rows } = await query(
      `SELECT ${SELECT_COLUMNS}
         FROM recurring_series rs
         LEFT JOIN account a ON a.id = rs.account_id
         LEFT JOIN category c ON c.id = rs.category_id
        ${includeEnded ? '' : "WHERE rs.status != 'ENDED'"}
        ORDER BY rs.next_expected_date ASC NULLS LAST, rs.name`
    );

    res.json(rows.map(withLapsed));
  } catch (err) {
    next(err);
  }
});

/** A series' own linked transaction history — the Calendar view's click-a-chip detail card. */
recurringRouter.get('/:id/transactions', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT id, posted_date::text, amount_cents, merchant, description, account_id
         FROM transaction WHERE recurring_series_id = $1
        ORDER BY posted_date DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Create — from a candidate, or manually
   ------------------------------------------------------------------ */

recurringRouter.post('/', validate(recurringCreateSchema), async (req, res, next) => {
  try {
    const b = req.body;

    // Guards against the same rule getting created twice — a stale
    // "Review detected" card confirmed a second time (a double-click,
    // two tabs open on the same candidate, or the same merchant
    // re-detected after its only series was ended — see
    // detectCandidates' docs) posts the exact same body, and nothing
    // about that request looks invalid on its own. Checks EVERY
    // status, including ENDED: an ended series' real history should
    // never get orphaned by a second, empty one — PATCH .../:id
    // {status: 'ACTIVE'} (Resume) is the only path back onto the
    // original. IS NOT DISTINCT FROM treats two NULLs as equal (a
    // plain NULL = NULL comparison wouldn't match), so "any account"
    // really compares equal to "any account", not silently failing.
    const { rows: dupes } = await query(
      `SELECT id, status FROM recurring_series
        WHERE LOWER(match_name_contains) = LOWER($1)
          AND match_amount_min_cents IS NOT DISTINCT FROM $2
          AND match_amount_max_cents IS NOT DISTINCT FROM $3
          AND account_id IS NOT DISTINCT FROM $4
          AND person_id IS NOT DISTINCT FROM $5`,
      [b.match_name_contains, orNull(b.match_amount_min_cents), orNull(b.match_amount_max_cents), orNull(b.account_id), orNull(b.person_id)]
    );
    if (dupes.length > 0) {
      const existing = dupes[0];
      const error = existing.status === 'ENDED'
        ? `"${b.match_name_contains}" already has an ended series (id ${existing.id}) — resume it instead of creating a new one`
        : `A recurring series already matches "${b.match_name_contains}" in that amount range`;
      return res.status(409).json({ error, existing_id: existing.id });
    }

    const series = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO recurring_series
           (name, glyph, category_id, account_id, person_id,
            match_name_contains, match_amount_min_cents, match_amount_max_cents, match_days_of_month,
            cadence, cadence_interval, expected_amount_cents, amount_varies,
            status, next_expected_date, confidence, created_from,
            first_seen_date, last_seen_date, occurrence_count)
         VALUES ($1,$2,$3,$4,$5, $6,$7,$8,$9, $10,$11,$12,$13, $14,$15,$16,$17, $18,$19,$20)
         RETURNING *`,
        [
          b.name, b.glyph, orNull(b.category_id), orNull(b.account_id), orNull(b.person_id),
          b.match_name_contains, orNull(b.match_amount_min_cents), orNull(b.match_amount_max_cents), orNull(b.match_days_of_month),
          b.cadence, b.cadence_interval, b.expected_amount_cents, b.amount_varies,
          b.status, orNull(b.next_expected_date), b.confidence, b.created_from,
          // first_seen_date/last_seen_date/occurrence_count are always
          // derived below from the transactions actually linked, never
          // taken from the request body — otherwise a DETECTED
          // candidate's own counts (already reflecting its evidence)
          // get added to a second time by the retroactive link just
          // below, double-counting the same rows.
          null, null, 0,
        ]
      );
      const created = rows[0];

      // Retroactively link the historical transactions that justify
      // this rule (the candidate's own evidence, for a DETECTED
      // series; any past match, for a MANUAL one) — confirming a
      // recurring bill should tag the purchases you just reviewed,
      // not only ones that arrive later.
      const { rows: unlinked } = await client.query(
        `SELECT t.id, t.posted_date::text, t.amount_cents, t.merchant, t.description, t.account_id, t.recurring_series_id, a.person_id
           FROM transaction t JOIN account a ON a.id = t.account_id
          WHERE t.amount_cents < 0 AND t.recurring_series_id IS NULL`
      );
      await matchAndLinkSeries(created, unlinked, client);

      const { rows: fresh } = await client.query(`SELECT * FROM recurring_series WHERE id = $1`, [created.id]);
      return fresh[0];
    });

    await audit({ action: 'recurring.created', entityType: 'recurring_series', entityId: series.id, detail: { name: series.name, created_from: series.created_from } });

    res.status(201).json(withLapsed(series));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Update — fixed allow-list, same pattern as accounts.js/loans.js.
   No DELETE route: end a series with status: 'ENDED'.
   ------------------------------------------------------------------ */

recurringRouter.patch('/:id', validate(recurringUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: existing } = await query('SELECT * FROM recurring_series WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Recurring series not found' });

    const allowed = [
      'name', 'glyph', 'category_id', 'account_id', 'person_id',
      'match_name_contains', 'match_amount_min_cents', 'match_amount_max_cents', 'match_days_of_month',
      'cadence', 'cadence_interval', 'expected_amount_cents', 'amount_varies', 'status',
    ];
    const sets = [];
    const values = [];

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(orNull(req.body[field]));
        sets.push(`${field} = $${values.length}`);
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    values.push(id);

    const { rows } = await query(
      `UPDATE recurring_series SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
      values
    );

    await audit({ action: 'recurring.updated', entityType: 'recurring_series', entityId: id, detail: { changed: Object.keys(req.body), changes: changesBetween(existing[0], rows[0], Object.keys(req.body)) } });

    res.json(withLapsed(rows[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Manual link / unlink
   ------------------------------------------------------------------ */

recurringRouter.post('/:id/link', validate(recurringLinkSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { transaction_id } = req.body;
    let notFound = null;

    await withTransaction(async (client) => {
      const { rows: seriesRows } = await client.query('SELECT * FROM recurring_series WHERE id = $1', [id]);
      if (seriesRows.length === 0) { notFound = 'Recurring series not found'; return; }
      const series = seriesRows[0];

      const { rows: txnRows } = await client.query('SELECT id, posted_date::text AS posted_date FROM transaction WHERE id = $1', [transaction_id]);
      if (txnRows.length === 0) { notFound = 'Transaction not found'; return; }
      const txn = txnRows[0];

      // Manual link is a deliberate override, not a rule match — it
      // updates the transaction directly rather than going through
      // matchesRule, but keeps the same series bookkeeping (occurrence
      // count, first/last seen, next_expected_date) any other match does.
      await client.query('UPDATE transaction SET recurring_series_id = $1 WHERE id = $2', [id, transaction_id]);

      const newLastSeen = [series.last_seen_date, txn.posted_date].filter(Boolean).sort().pop();
      const newFirstSeen = [series.first_seen_date, txn.posted_date].filter(Boolean).sort()[0];
      const nextExpected = addCadence(newLastSeen, series.cadence, series.cadence_interval, series.match_days_of_month);

      await client.query(
        `UPDATE recurring_series
            SET occurrence_count = occurrence_count + 1, last_seen_date = $2, first_seen_date = $3, next_expected_date = $4, updated_at = now()
          WHERE id = $1`,
        [id, newLastSeen, newFirstSeen, nextExpected]
      );

      await audit({ action: 'recurring.linked', entityType: 'transaction', entityId: transaction_id, detail: { recurring_series_id: id, manual: true } });
    });

    if (notFound) return res.status(404).json({ error: notFound });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

recurringRouter.post('/:id/unlink', validate(recurringLinkSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { transaction_id } = req.body;
    let notFound = null;

    await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        'UPDATE transaction SET recurring_series_id = NULL WHERE id = $1 AND recurring_series_id = $2',
        [transaction_id, id]
      );
      if (rowCount === 0) { notFound = 'That transaction is not linked to this series'; return; }

      const { rows: seriesRows } = await client.query('SELECT * FROM recurring_series WHERE id = $1', [id]);
      const series = seriesRows[0];

      const { rows: remaining } = await client.query(
        'SELECT COUNT(*)::int AS count, MAX(posted_date)::text AS last_seen FROM transaction WHERE recurring_series_id = $1',
        [id]
      );
      const { count, last_seen } = remaining[0];
      const nextExpected = last_seen ? addCadence(last_seen, series.cadence, series.cadence_interval, series.match_days_of_month) : series.next_expected_date;

      await client.query(
        'UPDATE recurring_series SET occurrence_count = $2, last_seen_date = $3, next_expected_date = $4, updated_at = now() WHERE id = $1',
        [id, count, last_seen, nextExpected]
      );

      await audit({ action: 'recurring.unlinked', entityType: 'transaction', entityId: transaction_id, detail: { recurring_series_id: id } });
    });

    if (notFound) return res.status(404).json({ error: notFound });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
