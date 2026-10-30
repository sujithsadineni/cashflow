/**
 * The permanent transaction record — read side.
 *
 * All filtering happens in SQL, not JavaScript: the database has
 * indexes and a query planner; pulling everything into Node to filter
 * it there throws both away.
 */

import { Router } from 'express';
import { query, withTransaction } from '../core/db.js';
import { matchNewTransactions } from './recurring.js';
import { audit } from '../core/audit.js';
import { changesBetween } from '../core/changes.js';
import {
  validate,
  validateQuery,
  transactionsQuerySchema,
  categorySummaryQuerySchema,
  transactionUpdateSchema,
} from '../core/validate.js';
import { spendSql, incomeSql, spenderSql } from '../money/spend.js';
import { rowCashbackSql } from '../money/flat-cashback.js';
import { learnPlaces, placeFor, placeKey } from '../merchants/place.js';
import { lineDetail } from '../merchants/line-detail.js';
import { paidWith } from '../merchants/payment-method.js';

export const transactionsRouter = Router();

transactionsRouter.get('/', validateQuery(transactionsQuerySchema), async (req, res, next) => {
  try {
    const { account_id, person_id, category_id, from, to, q, txn_type, place, limit, offset } = req.filters;

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

    if (account_id !== undefined) add('t.account_id = ANY(?)', account_id);
    // Whose the row is: a shared card's spender, else the account's person (D344).
    if (person_id !== undefined) add(`${spenderSql('t', 'a')} = ANY(?)`, person_id);
    if (category_id !== undefined) {
      const ids = category_id.filter((v) => v !== 'none').map(Number);
      const none = category_id.includes('none');
      if (ids.length && none) add('(t.category_id = ANY(?) OR t.category_id IS NULL)', ids);
      else if (ids.length) add('t.category_id = ANY(?)', ids);
      else where.push('t.category_id IS NULL');
    }
    if (from !== undefined) add('t.posted_date >= ?', from);
    if (to !== undefined) add('t.posted_date <= ?', to);
    if (txn_type !== undefined) add('t.txn_type = ANY(?)', txn_type);
    // Where each purchase happened (D224), read from its description, with store numbers
    // and cut-short towns learned from every purchase on file. Read once here: the Where
    // filter (D352) narrows to the rows whose place it names, and each row shows its place.
    const { rows: history } = await query(`SELECT id, merchant, description FROM transaction WHERE txn_type IN ('purchase', 'refund')`);
    const learned = learnPlaces(history);
    if (place !== undefined) {
      const wanted = new Set(place);
      // A whole state is "state:TX" (D370): every place in it, and a town printed without its
      // state counts where that town is printed with one.
      const places = history.map((h) => placeFor(h, learned));
      const townState = new Map();
      for (const p of places) if (p?.town && p.state && !townState.has(p.town.toLowerCase())) townState.set(p.town.toLowerCase(), p.state);
      const inState = (p) => {
        const st = p?.state || (p?.town ? townState.get(p.town.toLowerCase()) : null);
        return Boolean(st && wanted.has(`state:${st}`));
      };
      add('t.id = ANY(?)', history.filter((h, i) => wanted.has(placeKey(places[i])) || inState(places[i])).map((h) => h.id));
    }
    // ILIKE, not full-text search: search-as-you-type wants substring
    // matches ("lion" should find FOOD LION), which tsquery stems away.
    // Sequential scan is a non-issue at household row counts.
    // Checks merchant too, not just description — merchant is a
    // separately-edited field (renamed in the ledger after import),
    // so a search for the renamed name has to find it even when the
    // original statement description never contained that word.
    // $0.00 rows carry no money (BofA prints its interest headings at $0.00,
    // D308): left out of the list unless a search asks for them (D313).
    if (q === undefined || q === '') where.push('t.amount_cents <> 0');
    if (q !== undefined && q !== '') {
      values.push(`%${q}%`);
      where.push(`(t.description ILIKE $${values.length} OR t.merchant ILIKE $${values.length})`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS out_cents,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS in_cents,
              SUM(${rowCashbackSql('t', 'a')})::bigint AS cashback_cents
         FROM transaction t
         JOIN account a ON a.id = t.account_id
        ${whereSql}`,
      values
    );
    // What each month of the matching rows adds up to (D251), over every
    // matching row, not just this page: a month split across pages still
    // shows its whole total. Money out and money in, everything included
    // (transfers and card payments too): the sum of what's listed, not spending.
    const { rows: monthRows } = await query(
      `SELECT to_char(t.posted_date, 'YYYY-MM') AS month, COUNT(*)::int AS count,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS out_cents,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS in_cents
         FROM transaction t
         JOIN account a ON a.id = t.account_id
        ${whereSql}
        GROUP BY 1`,
      values
    );

    const { rows } = await query(
      `SELECT t.id, t.posted_date, t.description, t.merchant, t.amount_cents, t.txn_type, t.notes, t.payment_method, t.recurring_series_id,
              t.category_id, c.name AS category_name, c.icon_key AS category_icon_key,
              t.account_id, a.name AS account_name, a.nickname AS account_nickname, a.mask AS account_mask,
              -- Two open accounts with one nickname ("Zolve") need their last four to tell apart (D353).
              (SELECT count(*) FROM account x WHERE x.nickname = a.nickname AND x.is_active) > 1 AS account_nickname_shared,
              -- What the row earned on a card with a flat rate (D330); NULL everywhere else.
              ${rowCashbackSql('t', 'a')} AS cashback_cents,
              p.id AS person_id, p.name AS person_name, p.nickname AS person_nickname,
              -- On a shared card: the account's own person, and the section the statement printed it in (D344).
              a.person_id AS account_person_id, t.spender_name, t.card_ending,
              -- The printed line, for the bought date and wallet (D352); not sent.
              (SELECT st.raw_text FROM staged_transaction st WHERE st.transaction_id = t.id ORDER BY st.id LIMIT 1) AS raw_text,
              t.contact_id, ct.name AS contact_name, ct.nickname AS contact_nickname, ct.image_path AS contact_image_path,
              -- Where a card payment came from (D199): the bank row it matched, or
              -- why not and which bank it likely sits on. 'accounts_at_bank' lets
              -- the label add ···mask only when the bank has more than one account.
              CASE WHEN pm.id IS NULL THEN NULL ELSE json_build_object(
                'status', pm.status, 'reason', pm.reason, 'source', pm.source, 'via', pm.via,
                'person', pm.detail->>'person', 'location', pm.detail->>'location', 'label', pm.detail->>'label',
                'named_issuer', pm.detail->>'named_issuer', 'split', (pm.detail->>'split')::boolean,
                'part_count', (SELECT COUNT(*)::int FROM payment_match_part x WHERE x.match_id = pm.id),
                'bank', CASE WHEN ba.id IS NULL THEN NULL ELSE json_build_object(
                  'account_id', ba.id, 'account_name', ba.name, 'account_type', ba.account_type, 'issuer', ba.issuer, 'mask', ba.mask,
                  'posted_date', to_char(bt.posted_date, 'YYYY-MM-DD'), 'description', bt.description,
                  'accounts_at_bank', (SELECT COUNT(*)::int FROM account x WHERE x.issuer = ba.issuer AND x.account_type <> 'CREDIT_CARD'))
                END,
                'likely', CASE WHEN la.id IS NULL THEN NULL ELSE json_build_object(
                  'account_id', la.id, 'account_name', la.name, 'account_type', la.account_type, 'issuer', la.issuer, 'mask', la.mask,
                  'accounts_at_bank', (SELECT COUNT(*)::int FROM account x WHERE x.issuer = la.issuer AND x.account_type <> 'CREDIT_CARD'))
                END,
                'covered_from', pm.detail->>'covered_from',
                'covered_until', pm.detail->>'covered_until',
                'window', pm.detail->'window',
                'candidate_count', jsonb_array_length(COALESCE(pm.detail->'candidate_ids', '[]'::jsonb)))
              END AS payment_source,
              -- The other side: a bank row that verified a card payment (D199).
              CASE WHEN bm.id IS NULL THEN NULL ELSE json_build_object(
                'status', bm.status, 'via', bm.via, 'person', bm.detail->>'person',
                'part_count', (SELECT COUNT(*)::int FROM payment_match_part x WHERE x.match_id = bm.id),
                'card', json_build_object(
                  'account_id', ca.id, 'account_name', ca.name, 'issuer', ca.issuer, 'mask', ca.mask,
                  'posted_date', to_char(ctx.posted_date, 'YYYY-MM-DD'), 'description', ctx.description,
                  'accounts_with_name', (SELECT COUNT(*)::int FROM account x WHERE x.name = ca.name)))
              END AS payment_target,
              -- A transfer between the household's own accounts (D265): the other
              -- half's account and line, and which way the money went.
              CASE WHEN tm.id IS NULL THEN NULL ELSE json_build_object(
                'direction', CASE WHEN tm.out_transaction_id = t.id THEN 'to' ELSE 'from' END,
                'source', tm.source,
                'account_id', oa.id, 'account_name', oa.name, 'account_type', oa.account_type, 'issuer', oa.issuer, 'mask', oa.mask,
                'accounts_with_name', (SELECT COUNT(*)::int FROM account x WHERE x.name = oa.name),
                'posted_date', to_char(ot.posted_date, 'YYYY-MM-DD'), 'description', ot.description, 'amount_cents', ot.amount_cents)
              END AS transfer_link
         FROM transaction t
         JOIN account a ON a.id = t.account_id
         JOIN person p ON p.id = ${spenderSql('t', 'a')}
         LEFT JOIN category c ON c.id = t.category_id
         LEFT JOIN contact ct ON ct.id = t.contact_id
         LEFT JOIN payment_match pm ON pm.card_transaction_id = t.id
         LEFT JOIN transaction bt ON bt.id = pm.bank_transaction_id
         LEFT JOIN account ba ON ba.id = bt.account_id
         LEFT JOIN account la ON la.id = (pm.detail->>'likely_account_id')::int
         LEFT JOIN payment_match_part bp ON bp.transaction_id = t.id
         LEFT JOIN payment_match bm ON bm.id = bp.match_id
         LEFT JOIN transaction ctx ON ctx.id = bm.card_transaction_id
         LEFT JOIN account ca ON ca.id = ctx.account_id
         LEFT JOIN transfer_match tm ON t.id IN (tm.out_transaction_id, tm.in_transaction_id)
         LEFT JOIN transaction ot ON ot.id = CASE WHEN tm.out_transaction_id = t.id THEN tm.in_transaction_id ELSE tm.out_transaction_id END
         LEFT JOIN account oa ON oa.id = ot.account_id
        ${whereSql}
        ORDER BY t.posted_date DESC, t.id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    for (const r of rows) {
      r.place = r.txn_type === 'purchase' || r.txn_type === 'refund' ? placeFor(r, learned) : null;
      // The day it was bought and the wallet it was paid with, from its printed line (D352).
      const { sale_date } = lineDetail(r.raw_text, r.description, r.posted_date instanceof Date ? r.posted_date.toISOString().slice(0, 10) : String(r.posted_date).slice(0, 10));
      r.sale_date = sale_date;
      // How it was paid (D359): the person's pick, else what the line says (the wallet among it).
      r.paid_with = paidWith(r.payment_method, {
        raw: r.raw_text, description: r.description, txn_type: r.txn_type, place: r.place,
        billed: r.recurring_series_id != null || /subscription/i.test(r.category_name ?? ''),
      });
      delete r.raw_text;
      delete r.payment_method;
    }

    res.json({
      total: Number(countResult.rows[0].total),
      out_cents: Number(countResult.rows[0].out_cents),
      in_cents: Number(countResult.rows[0].in_cents),
      // A card with a flat rate (D330): what the matching rows earned; null on every other card.
      cashback_cents: countResult.rows[0].cashback_cents == null ? null : Number(countResult.rows[0].cashback_cents),
      months: Object.fromEntries(monthRows.map((m) => [m.month, { count: m.count, out_cents: Number(m.out_cents), in_cents: Number(m.in_cents) }])),
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

    const { rows: before } = await query('SELECT category_id, merchant, txn_type, payment_method FROM transaction WHERE id = $1', [id]);
    if (before.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    if (req.body.category_id != null) {
      const { rows } = await query('SELECT 1 FROM category WHERE id = $1', [req.body.category_id]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Unknown category', field: 'category_id' });
      }
    }

    // Fixed allow-list, same pattern as the accounts PATCH — column
    // names never come from user input.
    const allowed = ['category_id', 'merchant', 'txn_type', 'payment_method'];
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
        RETURNING id, category_id, merchant, txn_type, payment_method`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    await audit({
      action: 'transaction.edited',
      entityType: 'transaction',
      entityId: id,
      detail: { changed: Object.keys(req.body), changes: changesBetween(before[0], rows[0], Object.keys(req.body)) },
    });
    // A row given a bill's merchant joins the bill (D368).
    if (req.body.merchant !== undefined && rows[0].merchant !== before[0].merchant) {
      await withTransaction((client) => matchNewTransactions([id], client));
    }

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

/**
 * Per-category counts and totals for one card (D198): the buttons above
 * the Cards page's table, and the totals box beside them. The table is
 * paged, so the browser can't add these up itself. Money in and out are
 * kept apart (a Zelle category has both); uncategorised rows come back
 * as category_id null. Biggest first, by money moved either way.
 */
/**
 * GET /transactions/daily?month=YYYY-MM (D321): what was spent each day of a
 * month, by the Overview's rules (spendSql: refunds net it down), and how
 * many rows. Registered before /:id. For the Recurring calendar.
 */
/**
 * Every place the household's purchases happened (D352), for the Where filter:
 * [{ key, label, count }], most rows first, online first among equals.
 */
transactionsRouter.get('/places', async (req, res, next) => {
  try {
    const { rows: history } = await query(`SELECT id, merchant, description FROM transaction WHERE txn_type IN ('purchase', 'refund')`);
    const learned = learnPlaces(history);
    const counts = new Map();
    for (const h of history) {
      const p = placeFor(h, learned);
      const key = placeKey(p);
      if (!key) continue;
      const label = p.online ? 'Online' : `${p.town}${p.state ? `, ${p.state === 'IN' ? 'India' : p.state}` : ''}`;
      counts.set(key, { key, label, count: (counts.get(key)?.count ?? 0) + 1 });
    }
    res.json([...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)));
  } catch (err) {
    next(err);
  }
});

transactionsRouter.get('/daily', async (req, res, next) => {
  try {
    const month = String(req.query.month ?? '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'Use month=YYYY-MM', field: 'month' });
    const { rows } = await query(
      `SELECT to_char(t.posted_date, 'YYYY-MM-DD') AS date,
              (-COALESCE(SUM(t.amount_cents) FILTER (WHERE ${spendSql('t')}), 0))::bigint AS spent_cents,
              count(*)::int AS count
         FROM transaction t
        WHERE to_char(t.posted_date, 'YYYY-MM') = $1 AND t.amount_cents <> 0
        GROUP BY t.posted_date ORDER BY t.posted_date`,
      [month]
    );
    res.json(rows.map((r) => ({ ...r, spent_cents: Number(r.spent_cents) })));
  } catch (err) {
    next(err);
  }
});

transactionsRouter.get('/category-summary', validateQuery(categorySummaryQuerySchema), async (req, res, next) => {
  try {
    const { account_id, from, to } = req.filters;
    const values = [account_id];
    const where = ['t.account_id = $1'];
    if (from !== undefined) { values.push(from); where.push(`t.posted_date >= $${values.length}`); }
    if (to !== undefined) { values.push(to); where.push(`t.posted_date <= $${values.length}`); }
    const { rows } = await query(
      `SELECT t.category_id, c.name AS category_name, c.icon_key AS category_icon_key,
              COUNT(*)::int AS count,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS in_cents,
              COALESCE(-SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS out_cents
         FROM transaction t
         LEFT JOIN category c ON c.id = t.category_id
        WHERE ${where.join(' AND ')}
        GROUP BY t.category_id, c.name, c.icon_key
        ORDER BY SUM(abs(t.amount_cents)) DESC, c.name`,
      values
    );
    const categories = rows.map((r) => ({ ...r, in_cents: Number(r.in_cents), out_cents: Number(r.out_cents) }));
    const total = categories.reduce(
      (t, c) => ({ count: t.count + c.count, in_cents: t.in_cents + c.in_cents, out_cents: t.out_cents + c.out_cents }),
      { count: 0, in_cents: 0, out_cents: 0 }
    );
    res.json({ total, categories });
  } catch (err) {
    next(err);
  }
});

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
              -- Same rules as the Overview's Spent and Income cards (spend.js), so the
              -- bars match the cards and the Saved/Kept row beneath them (D168).
              COALESCE(LEAST(SUM(t.amount_cents) FILTER (WHERE ${spendSql('t')}), 0), 0) AS spend_cents,
              COALESCE(SUM(t.amount_cents) FILTER (WHERE ${incomeSql('t')}), 0) AS income_cents
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
      // Each row carries its own category name and icon. The Recent cards
      // used to look them up in by_category, but that list is emptied for
      // a single-category merchant (no chips needed), so every card fell
      // back to "Uncategorized" — a paycheck's 16 Salary rows, for one.
      query(
        `SELECT t.id, t.posted_date, t.description, t.amount_cents, t.category_id,
                c.name AS category_name, c.icon_key AS category_icon_key
           FROM transaction t
           LEFT JOIN category c ON c.id = t.category_id
          WHERE lower(t.merchant) = lower($1) ${categoryFilter}
          ORDER BY t.posted_date DESC
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

/**
 * Where one transaction lives — its account and date — so a link from
 * elsewhere (the cashback detail, D284) can open the Transactions page on
 * it. Registered last: the named routes above (category-summary, ...) win.
 */
transactionsRouter.get('/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const { rows } = await query(
      `SELECT id, account_id, to_char(posted_date, 'YYYY-MM-DD') AS posted_date FROM transaction WHERE id = $1`,
      [Number(req.params.id)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});
