/**
 * The staged rows of an import: list them with duplicate hints, and edit one before approval.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { Router } from 'express';

import { recoverMissingRows } from '../../statements/recover-rows.js';

import { query } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { validate, stagedUpdateSchema } from '../../core/validate.js';
import { statementTally } from '../../statements/tally.js';
import { duplicateMatchSql, findSameStatement, statementSummary } from './shared.js';
import { resolveSpender } from '../../statements/spender.js';
import { spenderContext } from '../../statements/spender-run.js';

const router = Router();
export { router as stagedRouter };

/* ------------------------------------------------------------------
   Look for missing rows (D214): re-read the stored PDF with today's
   reader and queue only what the saved rows lack, for approval.
   ?dry=1 lists them without queuing. It also compares the statement's
   balances with the fresh read; ?balances=1 saves the printed ones (D215).
   ------------------------------------------------------------------ */

router.post('/:id/recover', async (req, res, next) => {
  try {
    const result = await recoverMissingRows(Number(req.params.id), { dry: req.query.dry === '1', useBalances: req.query.balances === '1' });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Review: staged rows with duplicate detection
   ------------------------------------------------------------------ */

router.get('/:id/staged', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });

    /**
     * Refresh duplicate flags on every fetch rather than once at parse
     * time: the transaction table changes (earlier batches get
     * approved), so a flag computed last week may be stale in either
     * direction. The cost is one UPDATE over this batch's rows.
     *
     * A staged row is a suspected duplicate when an existing
     * transaction on the same account has the same amount, a matching
     * normalized description, and a posted date within 3 days.
     */
    await query(
      `UPDATE staged_transaction s
          SET duplicate_of_id = (
            SELECT t.id
              FROM transaction t
              JOIN import_batch b ON b.id = s.import_batch_id
             WHERE ${duplicateMatchSql('b.account_id')}
             ORDER BY abs(t.posted_date - s.posted_date)
             LIMIT 1
          )
        WHERE s.import_batch_id = $1
          AND s.review_status = 'PENDING'
          AND s.posted_date IS NOT NULL
          AND s.amount_cents IS NOT NULL
          AND s.description IS NOT NULL`,
      [id]
    );

    /**
     * Once approved, the live `transaction` row (via s.transaction_id,
     * migration 009) is the source of truth — merchant/type/category
     * can be edited later from the main ledger, and this screen must
     * show that, not the frozen parse-time snapshot. COALESCE falls
     * back to the staged columns for a still-pending row, where
     * transaction_id is null and there's nothing else to show yet.
     */
    const { rows } = await query(
      `SELECT s.id, s.posted_date, s.description,
              COALESCE(lt.merchant, s.merchant) AS merchant,
              COALESCE(lt.amount_cents, s.amount_cents) AS amount_cents,
              COALESCE(lt.txn_type, s.txn_type) AS txn_type,
              s.suggested_category, lt.category_id, c.name AS category_name, c.icon_key AS category_icon_key,
              s.confidence, s.review_status, s.transaction_id,
              s.duplicate_of_id, s.raw_text,
              -- The section of a shared card's statement it was printed in (D344), for the reading's dividers (D360).
              s.spender_name, s.card_ending,
              t.posted_date AS duplicate_posted_date,
              t.description AS duplicate_description,
              -- What the row may duplicate, for its review panel to set side by side (D335).
              t.merchant AS duplicate_merchant, t.amount_cents AS duplicate_amount_cents,
              t.import_batch_id AS duplicate_batch_id, tb.period_start AS duplicate_period_start, tb.period_end AS duplicate_period_end
         FROM staged_transaction s
         LEFT JOIN transaction t ON t.id = s.duplicate_of_id
         LEFT JOIN import_batch tb ON tb.id = t.import_batch_id
         LEFT JOIN transaction lt ON lt.id = s.transaction_id
         LEFT JOIN category c ON c.id = lt.category_id
        WHERE s.import_batch_id = $1
        ORDER BY s.posted_date NULLS FIRST, s.id`,
      [id]
    );

    const batch = batches[0];
    const { summary, totals } = await statementSummary(batch);
    const tally = statementTally({
      accountType: totals.account_type ?? batch.detected_account_type,
      openingCents: summary.opening_cents,
      closingCents: summary.closing_cents,
      rows,
    });

    // On a shared card, who each printed section is (D360): the members decide, as when it's filed
    // (D344); a section nobody accounts for keeps its printed name. Rows outside any section get none.
    const proposed = new Map();
    if (batch.account_id && rows.some((r) => r.spender_name || r.card_ending)) {
      const ctx = await spenderContext({ query }, batch.account_id);
      const { rows: people } = await query(
        `SELECT p.id, p.name FROM person p JOIN account a ON a.id = $1
          WHERE p.id = a.person_id OR p.id IN (SELECT person_id FROM account_member WHERE account_id = $1)`, [batch.account_id]);
      const { rows: [account] } = await query('SELECT person_id FROM account WHERE id = $1', [batch.account_id]);
      for (const r of rows) {
        if (!r.spender_name && !r.card_ending) continue;
        const who = resolveSpender(r, ctx);
        const personId = who.personId ?? account.person_id;
        r.person_id = personId;
        // A printed name nobody on the card accounts for (D100): said in the statement's notes.
        if (who.proposed) {
          const key = `${r.spender_name ?? ''}|${r.card_ending ?? ''}`;
          proposed.set(key, { printed_name: r.spender_name, card_ending: r.card_ending, rows: (proposed.get(key)?.rows ?? 0) + 1 });
        }
        r.person_name = people.find((p) => p.id === personId)?.name ?? null;
      }
    }

    // The same statement already saved (D307), said once for the whole file.
    const sameStatement = batch.status === 'REVIEW' && batch.account_id && batch.period_end
      ? await findSameStatement(batch.account_id, batch.id, batch.period_end)
      : null;
    res.json({ batch, rows, tally, summary, same_statement: sameStatement, context: await statementContext(batch, rows, [...proposed.values()]) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Edit a staged row's category before approval
   ------------------------------------------------------------------ */

router.patch('/:id/staged/:sid', validate(stagedUpdateSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sid = Number(req.params.sid);

    if (req.body.suggested_category != null) {
      const { rows } = await query('SELECT 1 FROM category WHERE name = $1', [req.body.suggested_category]);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Unknown category', field: 'suggested_category' });
      }
    }

    const allowed = ['suggested_category', 'merchant', 'txn_type', 'posted_date'];
    const sets = [];
    const values = [id, sid];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        values.push(req.body[field]);
        sets.push(`${field} = $${values.length}`);
      }
    }

    const { rows } = await query(
      `UPDATE staged_transaction SET ${sets.join(', ')}
        WHERE import_batch_id = $1 AND id = $2 AND review_status = 'PENDING'
        RETURNING id, suggested_category, merchant, txn_type, posted_date`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Staged row not found or already reviewed' });
    }

    // No audit entry: staging is scratch space, and the approval that
    // makes this real is audited with the final values.
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});


/* ------------------------------------------------------------------
   Skip a line, or bring it back (D335). A line that's the same purchase
   saved from another statement, or one that isn't a transaction at all,
   used to stay pending for good: leaving it unticked was the only way
   to keep it out, and "Approve all" let it through. Skipping marks it
   REJECTED (never deleted, so it can come back) and is audited, since
   it decides that a printed line never becomes a transaction.
   ------------------------------------------------------------------ */

async function setSkipped(req, res, next, skipped) {
  try {
    const id = Number(req.params.id);
    const sid = Number(req.params.sid);
    const { rows } = await query(
      `UPDATE staged_transaction SET review_status = $3
        WHERE import_batch_id = $1 AND id = $2 AND review_status = $4
        RETURNING id, posted_date, description, amount_cents, duplicate_of_id`,
      [id, sid, skipped ? 'REJECTED' : 'PENDING', skipped ? 'PENDING' : 'REJECTED']
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: skipped ? 'Staged row not found or already reviewed' : 'Staged row not found or not skipped' });
    }
    const row = rows[0];
    await audit({
      action: skipped ? 'staged_transaction.skipped' : 'staged_transaction.restored',
      entityType: 'import_batch',
      entityId: id,
      detail: { staged_id: row.id, posted_date: row.posted_date, description: row.description, amount_cents: row.amount_cents, duplicate_of_id: row.duplicate_of_id },
    });
    res.json({ id: row.id, review_status: skipped ? 'REJECTED' : 'PENDING' });
  } catch (err) {
    next(err);
  }
}

router.post('/:id/staged/:sid/skip', (req, res, next) => setSkipped(req, res, next, true));
router.post('/:id/staged/:sid/restore', (req, res, next) => setSkipped(req, res, next, false));

/**
 * What this statement says that's worth a line in its notes (D360): its credit
 * limit, purchase APR and mailing address against the account's statement
 * before it, a terms notice, plans still being paid, which bank account paid
 * each payment row (once matched), and names nobody on a shared card accounts
 * for. Facts only; web/src/lib/imports/statement-notes.js words them. The
 * address itself isn't sent, only whether it changed.
 */
async function statementContext(batch, rows, proposed) {
  const { rows: [own] } = await query(
    `SELECT period_end::text AS period_end, credit_limit_cents, apr_purchase_bps, mailing_address, terms_notice, plans
       FROM statement WHERE import_batch_id = $1`, [batch.id]);
  const end = own?.period_end ?? batch.period_end;
  const { rows: [previous] } = batch.account_id && end ? await query(
    `SELECT period_end::text AS period_end, credit_limit_cents, apr_purchase_bps, mailing_address, total_spend_cents
       FROM statement WHERE account_id = $1 AND period_end < $2 AND import_batch_id <> $3
      ORDER BY period_end DESC LIMIT 1`, [batch.account_id, end, batch.id]) : { rows: [] };
  const read = batch.detected_summary ?? {};
  const num = (v) => (v == null ? null : Number(v));
  const ids = rows.filter((r) => r.transaction_id).map((r) => r.transaction_id);
  const { rows: paid } = ids.length ? await query(
    `SELECT pm.card_transaction_id AS transaction_id, a.name, a.mask, a.issuer, a.account_type
       FROM payment_match pm
       JOIN transaction bt ON bt.id = pm.bank_transaction_id
       JOIN account a ON a.id = bt.account_id
      WHERE pm.status = 'verified' AND pm.card_transaction_id = ANY($1)`, [ids]) : { rows: [] };
  const rowOf = new Map(rows.map((r) => [r.transaction_id, r.id]));
  // A bank account's side of the same matches: the cards its rows paid (D199).
  const { rows: [acct] } = batch.account_id ? await query('SELECT account_type, credit_limit_manual_cents FROM account WHERE id = $1', [batch.account_id]) : { rows: [] };
  const card = acct?.account_type === 'CREDIT_CARD';
  const { rows: cards } = !card && ids.length ? await query(
    `SELECT bp.transaction_id, a.id AS card_id, a.name, a.nickname, a.mask
       FROM payment_match pm
       JOIN payment_match_part bp ON bp.match_id = pm.id
       JOIN transaction ct ON ct.id = pm.card_transaction_id
       JOIN account a ON a.id = ct.account_id
      WHERE pm.status = 'verified' AND bp.transaction_id = ANY($1)
     UNION
     SELECT pm.bank_transaction_id, a.id AS card_id, a.name, a.nickname, a.mask
       FROM payment_match pm
       JOIN transaction ct ON ct.id = pm.card_transaction_id
       JOIN account a ON a.id = ct.account_id
      WHERE pm.status = 'verified' AND pm.bank_transaction_id = ANY($1)`, [ids]) : { rows: [] };
  // What each payment went against (D394): the card's newest statement closed by the payment's
  // day, its balance and minimum, and what earlier verified payments since its close already paid.
  const rowByTxn = new Map(rows.map((r) => [r.transaction_id, r]));
  const against = await Promise.all(cards.map(async (c) => {
    const day = rowByTxn.get(c.transaction_id)?.posted_date;
    if (!day) return null;
    const { rows: [st] } = await query(
      `SELECT to_char(period_end, 'YYYY-MM-DD') AS period_end, closing_balance_cents, minimum_payment_cents
         FROM statement WHERE account_id = $1 AND period_end <= $2 ORDER BY period_end DESC LIMIT 1`, [c.card_id, day]);
    if (!st || st.closing_balance_cents == null) return null;
    // The statement still open on that day, for a payment made ahead of it.
    const { rows: [next] } = await query(
      `SELECT to_char(period_end, 'YYYY-MM-DD') AS period_end FROM statement WHERE account_id = $1 AND period_end > $2 ORDER BY period_end LIMIT 1`, [c.card_id, day]);
    const { rows: [before] } = await query(
      `SELECT COALESCE(SUM(-t.amount_cents), 0) AS cents
         FROM payment_match pm
         JOIN transaction t ON t.id = pm.bank_transaction_id
         JOIN transaction ct ON ct.id = pm.card_transaction_id
        WHERE pm.status = 'verified' AND ct.account_id = $1 AND t.posted_date > $2
          AND (t.posted_date < $3 OR (t.posted_date = $3 AND t.id < $4))`, [c.card_id, st.period_end, day, c.transaction_id]);
    return { period_end: st.period_end, balance_cents: num(st.closing_balance_cents), minimum_cents: num(st.minimum_payment_cents), paid_before_cents: num(before.cents), next_period_end: next?.period_end ?? null };
  }));
  return {
    credit_limit_cents: num(own?.credit_limit_cents ?? read.credit_limit_cents),
    credit_limit_manual_cents: num(acct?.credit_limit_manual_cents),
    apr_purchase_bps: own?.apr_purchase_bps ?? read.apr_purchase_bps ?? null,
    terms_notice: own?.terms_notice ?? read.terms_notice ?? null,
    plans: (own?.plans ?? read.plans)?.items ?? [],
    address_changed: Boolean(previous?.mailing_address && own?.mailing_address
      && previous.mailing_address.replace(/\s+/g, ' ').trim().toUpperCase() !== own.mailing_address.replace(/\s+/g, ' ').trim().toUpperCase()),
    previous: previous ? { period_end: previous.period_end, credit_limit_cents: num(previous.credit_limit_cents), apr_purchase_bps: previous.apr_purchase_bps, total_spend_cents: num(previous.total_spend_cents) } : null,
    payments: paid.map((p) => ({ row_id: rowOf.get(p.transaction_id), account: { name: p.name, mask: p.mask, issuer: p.issuer, account_type: p.account_type } })),
    // A card's payment rows no bank row has been matched to yet (pending ones can't be, until they're
    // saved). Only a card's: on a bank account those rows are the payments to the cards, matched below.
    unmatched_payments: card ? rows.filter((r) => r.txn_type === 'payment' && r.review_status !== 'REJECTED'
      && !paid.some((p) => p.transaction_id === r.transaction_id)).map((r) => r.id) : [],
    paid_cards: cards.map((c, i) => ({
      row_id: rowOf.get(c.transaction_id), account: { name: c.nickname ?? c.name, mask: c.mask },
      paid_cents: -num(rowByTxn.get(c.transaction_id)?.amount_cents ?? 0), statement: against[i],
    })),
    // A bank account's card payments no card row has been matched to yet (D392): each gets its
    // own ❗ note until a card statement verifies it, then it's one of paid_cards above. Which rows
    // are card payments is the matcher's own rule (payment-match-run.js): a loan payment isn't one.
    unverified_card_payments: !card ? rows.filter((r) => r.review_status !== 'REJECTED'
      && (r.category_name === 'Card Payment' || (r.txn_type === 'payment' && (r.category_name ?? '') !== 'Loan'))
      && !cards.some((c) => c.transaction_id === r.transaction_id)).map((r) => ({ row_id: r.id, name: r.merchant ?? r.description, paid_cents: -num(r.amount_cents) })) : [],
    proposed,
  };
}
