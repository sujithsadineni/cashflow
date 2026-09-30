/**
 * The permanent transaction record — read side.
 *
 * All filtering happens in SQL, not JavaScript: the database has
 * indexes and a query planner; pulling everything into Node to filter
 * it there throws both away.
 */

import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { changesBetween } from '../changes.js';
import {
  validate,
  validateQuery,
  transactionsQuerySchema,
  transactionUpdateSchema,
} from '../validate.js';

export const transactionsRouter = Router();

transactionsRouter.get('/', validateQuery(transactionsQuerySchema), async (req, res, next) => {
  try {
    const { account_id, person_id, category_id, from, to, q, txn_type, limit, offset } = req.filters;

    /**
     * WHERE clauses assembled from a fixed set in code — user input
     * only ever becomes a parameter value, never SQL text.
     */
    const where = [];
    const values = [];
    const add = (clause, value) => {
      values.push(value);
      where.push(clause.replace('?', `$${values.length}`));
    };

    if (account_id !== undefined) add('t.account_id = ?', account_id);
    if (person_id !== undefined) add('a.person_id = ?', person_id);
    if (category_id !== undefined) add('t.category_id = ?', category_id);
    if (from !== undefined) add('t.posted_date >= ?', from);
    if (to !== undefined) add('t.posted_date <= ?', to);
    if (txn_type !== undefined) add('t.txn_type = ?', txn_type);
    // ILIKE, not full-text search: search-as-you-type wants substring
    // matches ("lion" should find FOOD LION), which tsquery stems away.
    // Sequential scan is a non-issue at household row counts.
    // Checks merchant too, not just description — merchant is a
    // separately-edited field (renamed in the ledger after import),
    // so a search for the renamed name has to find it even when the
    // original statement description never contained that word.
    if (q !== undefined && q !== '') {
      values.push(`%${q}%`);
      where.push(`(t.description ILIKE $${values.length} OR t.merchant ILIKE $${values.length})`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) AS total
         FROM transaction t
         JOIN account a ON a.id = t.account_id
        ${whereSql}`,
      values
    );

    const { rows } = await query(
      `SELECT t.id, t.posted_date, t.description, t.merchant, t.amount_cents, t.txn_type, t.notes,
              t.category_id, c.name AS category_name, c.icon_key AS category_icon_key,
              t.account_id, a.name AS account_name, a.mask AS account_mask,
              p.id AS person_id, p.name AS person_name,
              t.contact_id, ct.name AS contact_name, ct.nickname AS contact_nickname, ct.image_path AS contact_image_path
         FROM transaction t
         JOIN account a ON a.id = t.account_id
         JOIN person p ON p.id = a.person_id
         LEFT JOIN category c ON c.id = t.category_id
         LEFT JOIN contact ct ON ct.id = t.contact_id
        ${whereSql}
        ORDER BY t.posted_date DESC, t.id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    res.json({
      total: Number(countResult.rows[0].total),
      limit,
      offset,
      rows,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Edit — recategorizing after approval.

   The category is presentation-layer truth, not statement truth, so
   changing it later is safe and expected ("that Costco run was
   actually Groceries"). The amount, date and description came off a
   statement and stay immutable here.
   ------------------------------------------------------------------ */

transactionsRouter.patch('/:id', validate(transactionUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: before } = await query('SELECT category_id, merchant, txn_type FROM transaction WHERE id = $1', [id]);
    if (before.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    if (req.body.category_id != null) {
      const { rows } = await query('SELECT 1 FROM category WHERE id = $1', [req.body.category_id]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Unknown category', field: 'category_id' });
      }
    }

    // Fixed allow-list, same pattern as the accounts PATCH — column
    // names never come from user input.
    const allowed = ['category_id', 'merchant', 'txn_type'];
    const sets = [];
    const values = [];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(req.body[field]);
        sets.push(`${field} = $${values.length}`);
      }
    }
    values.push(id);

    const { rows } = await query(
      `UPDATE transaction SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING id, category_id, merchant, txn_type`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    await audit({
      action: 'transaction.edited',
      entityType: 'transaction',
      entityId: id,
      detail: { changed: Object.keys(req.body), changes: changesBetween(before[0], rows[0], Object.keys(req.body)) },
    });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Trends — money out and money in over time, for the dashboard
   graphs. Buckets are generated in SQL so quiet weeks show as zero
   instead of disappearing.
   ------------------------------------------------------------------ */

transactionsRouter.get('/trends', async (req, res, next) => {
  try {
    const granularity = req.query.granularity ?? 'month';
    if (!['week', 'month', 'year'].includes(granularity)) {
      return res.status(400).json({ error: 'granularity must be week, month or year' });
    }

    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = req.query.month ?? defaultMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    }
    const start = `${month}-01`;

    /**
     * The window follows the calendar the user picked: the weeks of
     * that month, the twelve months of that year, or every year since
     * the first transaction. Buckets come from generate_series so a
     * quiet week renders as zero instead of disappearing. The interval
     * strings come from this switch, never from the request; the date
     * is parameterised.
     */
    const series = {
      week: `generate_series(date_trunc('week', $1::date),
                             date_trunc('week', $1::date + interval '1 month' - interval '1 day'),
                             interval '1 week')`,
      month: `generate_series(date_trunc('year', $1::date),
                              date_trunc('year', $1::date) + interval '11 months',
                              interval '1 month')`,
      year: `generate_series(date_trunc('year', (SELECT COALESCE(MIN(posted_date), CURRENT_DATE) FROM transaction)),
                             date_trunc('year', now()), interval '1 year')`,
    }[granularity];

    const params = granularity === 'year' ? [] : [start];

    const { rows } = await query(
      `SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket_start,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0 AND COALESCE(t.txn_type,'') NOT IN ('payment','transfer','savings')), 0) AS spend_cents,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0 AND COALESCE(t.txn_type,'') NOT IN ('payment','transfer')), 0) AS income_cents
         FROM ${series} AS b(bucket)
         LEFT JOIN transaction t
           ON date_trunc('${granularity}', t.posted_date) = b.bucket
        GROUP BY b.bucket
        ORDER BY b.bucket`,
      params
    );

    res.json({ granularity, month, buckets: rows });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Merchant history — "how much have I spent at Costco lately?".
   Click-through from the merchant avatar in the ledger.
   ------------------------------------------------------------------ */

transactionsRouter.get('/merchant-summary', async (req, res, next) => {
  try {
    const merchant = typeof req.query.merchant === 'string' ? req.query.merchant.trim() : '';
    if (!merchant) {
      return res.status(400).json({ error: 'merchant is required', field: 'merchant' });
    }

    // Optional: narrow everything below to one category — a merchant
    // like Tesla covers both a subscription and Supercharging, and
    // lumping every category into one blob was the whole complaint
    // this filter exists to fix. `category_id` is untrusted user
    // input, so it's parsed to a real integer or dropped, never
    // interpolated as a string. The literal "none" is a real, distinct
    // filter — "only this merchant's uncategorized rows" — not the
    // absence of one; `category_id = NULL` never matches in SQL, so
    // that slice needs its own IS NULL branch rather than falling
    // through to "no filter at all".
    let categoryFilter = '';
    let filterParams = [merchant];
    if (req.query.category_id === 'none') {
      categoryFilter = 'AND category_id IS NULL';
    } else {
      const categoryIdParam = Number(req.query.category_id);
      if (Number.isInteger(categoryIdParam)) {
        categoryFilter = 'AND category_id = $2';
        filterParams = [merchant, categoryIdParam];
      }
    }

    const [totals, byMonth, recent, byCategory] = await Promise.all([
      // Unfiltered by sign — a category slice isn't always spend. The
      // "amount_cents < 0" filter this replaced made every all-positive
      // category (Cashback, Refund, a Card Payment credit) silently sum
      // to 0 (and the by_month rows below empty out the same way) even
      // though those are exactly the transactions this card is meant to
      // total. The frontend now labels/colors this based on which way
      // net_cents actually points, per slice, rather than the query
      // assuming "spend" up front.
      query(
        `SELECT
           COALESCE(SUM(amount_cents), 0) AS net_cents,
           COUNT(*) AS transaction_count,
           MIN(posted_date) AS first_seen,
           MAX(posted_date) AS last_seen
         FROM transaction
        WHERE lower(merchant) = lower($1) ${categoryFilter}`,
        filterParams
      ),
      query(
        `SELECT to_char(date_trunc('month', posted_date), 'YYYY-MM') AS month,
                SUM(amount_cents) AS net_cents
           FROM transaction
          WHERE lower(merchant) = lower($1) ${categoryFilter}
          GROUP BY date_trunc('month', posted_date)
          ORDER BY date_trunc('month', posted_date) DESC
          LIMIT 24`,
        filterParams
      ),
      query(
        `SELECT id, posted_date, description, amount_cents, category_id
           FROM transaction
          WHERE lower(merchant) = lower($1) ${categoryFilter}
          ORDER BY posted_date DESC
          LIMIT 8`,
        filterParams
      ),
      // Always unfiltered, regardless of categoryId above — this is
      // what draws the category chips themselves, so it needs every
      // category this merchant has ever been tagged with, not just
      // the one currently selected.
      query(
        `SELECT t.category_id, c.name AS category_name, c.icon_key AS category_icon_key,
                COALESCE(SUM(t.amount_cents), 0) AS net_cents,
                COUNT(*) AS transaction_count
           FROM transaction t
           LEFT JOIN category c ON c.id = t.category_id
          WHERE lower(t.merchant) = lower($1)
          GROUP BY t.category_id, c.name, c.icon_key
          ORDER BY ABS(COALESCE(SUM(t.amount_cents), 0)) DESC`, // biggest activity (either direction) first
        [merchant]
      ),
    ]);

    if (Number(totals.rows[0].transaction_count) === 0) {
      return res.status(404).json({ error: 'No transactions found for that merchant' });
    }

    res.json({
      merchant,
      net_cents: totals.rows[0].net_cents,
      transaction_count: Number(totals.rows[0].transaction_count),
      first_seen: totals.rows[0].first_seen,
      last_seen: totals.rows[0].last_seen,
      by_month: byMonth.rows,
      recent: recent.rows,
      // Only worth showing as chips when there's more than one —
      // a single-category merchant looks exactly like it did before.
      by_category: byCategory.rows.length > 1
        ? byCategory.rows.map((r) => ({
            category_id: r.category_id,
            category_name: r.category_name ?? 'Uncategorized',
            category_icon_key: r.category_icon_key,
            net_cents: r.net_cents,
            transaction_count: Number(r.transaction_count),
          }))
        : [],
    });
  } catch (err) {
    next(err);
  }
});
