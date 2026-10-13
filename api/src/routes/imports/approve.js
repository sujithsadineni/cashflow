/**
 * Approve staged rows into transactions, and approve one past the duplicate check.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { createHash } from 'node:crypto';

import { Router } from 'express';

import { query, withTransaction } from '../../db.js';
import { audit } from '../../audit.js';
import { validate, approveSchema } from '../../validate.js';
import { autoZelleReview } from '../../zelle.js';
import { applyZelleReview } from '../zelle.js';
import { runRecheck, markVerification } from '../transaction-review.js';
import { rematchAllCards } from '../../payment-match-run.js';
import { matchNewTransactions } from '../recurring.js';
import { flagOrFixMerchants } from '../../merchant-review.js';

const router = Router();
export { router as approveRouter };

/* ------------------------------------------------------------------
   Approve — move staged rows into the permanent record
   ------------------------------------------------------------------ */

const normalizeDescription = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Plain dollar string for an error message — not formatMoney(), that's web-only. */
const formatCentsForError = (cents) => {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
};

router.post('/:id/approve', validate(approveSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { staged_ids, all } = req.body;

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    if (batch.status === 'NEEDS_ACCOUNT' || batch.account_id == null) {
      return res.status(409).json({ error: 'Confirm which account this statement belongs to first' });
    }
    if (batch.status !== 'REVIEW' && batch.status !== 'APPROVED') {
      return res.status(409).json({ error: 'This import has not been parsed yet' });
    }

    const { rows: staged } = all
      ? await query(
          `SELECT * FROM staged_transaction
            WHERE import_batch_id = $1 AND review_status = 'PENDING' ORDER BY id`,
          [id]
        )
      : await query(
          `SELECT * FROM staged_transaction
            WHERE import_batch_id = $1 AND review_status = 'PENDING' AND id = ANY($2) ORDER BY id`,
          [id, staged_ids]
        );

    if (staged.length === 0) {
      return res.status(400).json({ error: 'Nothing to approve' });
    }

    // A row missing its date, description or amount cannot become a
    // transaction (those columns are NOT NULL, deliberately). Refuse
    // the whole request rather than approving a subset the caller
    // didn't ask for.
    const incomplete = staged.filter(
      (r) => r.posted_date === null || r.description === null || r.amount_cents === null
    );
    if (incomplete.length > 0) {
      return res.status(422).json({
        error: 'Some rows are missing a date, description or amount — fix or leave them unchecked',
        staged_ids: incomplete.map((r) => r.id),
      });
    }

    const { rows: categories } = await query('SELECT id, name FROM category');
    const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
    const { rows: people } = await query('SELECT name FROM person');

    /**
     * Everything below commits together or not at all. A half-imported
     * statement is worse than a failed one — you'd have no clean way
     * to know which half made it.
     *
     * `failing` is tracked outside the transaction callback so that if
     * the dedupe constraint fires, the catch block below still knows
     * which staged row was being inserted — without it, the error
     * handler only sees "a 23505 happened somewhere," which is exactly
     * the unhelpful message this replaces.
     */
    let approvedCount;
    let failing = null;
    try {
      approvedCount = await withTransaction(async (client) => {
        const insertedIds = [];

        for (const row of staged) {
          failing = row;
          const dedupeHash = createHash('sha256')
            .update(
              `${batch.account_id}|${row.posted_date}|${row.amount_cents}|${normalizeDescription(row.description)}`
            )
            .digest('hex');

          const { rows: inserted } = await client.query(
            `INSERT INTO transaction
               (account_id, import_batch_id, posted_date, description, merchant,
                amount_cents, txn_type, category_id, dedupe_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              batch.account_id,
              id,
              row.posted_date,
              row.description,
              row.merchant,
              row.amount_cents,
              row.txn_type,
              categoryIdByName.get(row.suggested_category) ?? null,
              dedupeHash,
            ]
          );
          insertedIds.push(inserted[0].id);

          // Recorded so the statement's Review screen can later edit
          // the real transaction directly instead of a frozen,
          // nobody-else-reads-it staged snapshot — see migration 009.
          await client.query(
            `UPDATE staged_transaction SET review_status = 'APPROVED', transaction_id = $2 WHERE id = $1`,
            [row.id, inserted[0].id]
          );

          // Zelle transactions used to wait on a person to review each
          // one by hand (ZelleReview.jsx) — now applied automatically
          // on approval, same rule a reviewer would apply: internal
          // (a household name) regardless of sign, else Sent/Received
          // by the amount's own sign. Still just a starting guess, not
          // fact — the review screen's PATCH stays available to
          // correct any row this gets wrong. See api/src/zelle.js.
          if (/zelle/i.test(row.description)) {
            await applyZelleReview(client, {
              id: inserted[0].id,
              ...autoZelleReview(row.description, row.amount_cents, people),
            });
          }
        }

        await client.query(
          `UPDATE import_batch
              SET status = 'APPROVED',
                  rows_approved = rows_approved + $2,
                  approved_at = now()
            WHERE id = $1`,
          [id, staged.length]
        );

        // Merchant cleanup FIRST: a confident match to an existing
        // merchant is fixed automatically, anything less certain lands
        // in the review queue — see merchant-review.js. This has to
        // run before recurring-matching, not after: a local parser
        // (parse/pdf-local-*.js) can leave merchant null for a
        // description it doesn't recognize (e.g. "Wells Fargo Auto
        // Draft PPD ID: ..."), and matchesRule's very first check is
        // `if (!transaction.merchant) return false` — matching against
        // the pre-cleanup null merchant meant a real recurring bill
        // could silently miss its own series forever, since matching
        // only ever runs once, right after this approval (a real case,
        // not hypothetical: caught when a Chase statement's Wells
        // Fargo car-loan draft didn't link to its already-confirmed
        // series).
        await flagOrFixMerchants(insertedIds, client);

        // Confirmed recurring rules catch their own future transactions
        // from here on, without re-running detection — see routes/recurring.js.
        await matchNewTransactions(insertedIds, client);

        return staged.length;
      });
    } catch (err) {
      // The dedupe constraint fired: one of these rows already exists
      // as a transaction. Nothing was committed. Name the actual row
      // and, if we can find it, the existing transaction it collides
      // with — "one of these rows" with no further detail leaves
      // nothing to act on.
      if (err.code === '23505') {
        let existing = null;
        if (failing) {
          const { rows: match } = await query(
            `SELECT id, posted_date, description, amount_cents
               FROM transaction
              WHERE account_id = $1 AND posted_date = $2 AND amount_cents = $3
              ORDER BY id LIMIT 1`,
            [batch.account_id, failing.posted_date, failing.amount_cents]
          );
          existing = match[0] ?? null;
        }

        return res.status(409).json({
          error: failing
            ? `"${failing.description}" (${failing.posted_date}, ${formatCentsForError(failing.amount_cents)}) already exists as a transaction. Nothing was approved — deselect it and try again.`
            : 'One of these rows already exists as a transaction. Nothing was approved.',
          staged_id: failing?.id ?? null,
          existing_transaction: existing,
        });
      }
      throw err;
    }

    await audit({
      action: 'import.approved',
      entityType: 'import_batch',
      entityId: id,
      detail: { rows_approved: approvedCount, all: all === true },
    });

    // Re-check with the new rows in the history (D175), and re-match card
    // payments, which a new bank statement may verify (D199). Awaited so
    // the toast can say what the upload changed (D201) — both take well
    // under a second at household size. Best-effort: a failure here
    // mustn't undo or blemish an approval that already succeeded.
    let follow_up = null;
    try {
      await markVerification();
      const review = await runRecheck();
      const { summary } = await rematchAllCards();
      follow_up = {
        review_added: review.added,
        payments_verified: summary.newly_verified,
        payments_named: summary.newly_named,
        payments_unknown: summary.payments - summary.verified - summary.named,
      };
    } catch (err) {
      req.log?.warn({ err }, 're-check after approval failed');
    }

    res.json({ id, status: 'APPROVED', rows_approved: approvedCount, follow_up });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
   Approve one row anyway, past the exact-duplicate constraint.

   D6/D13's dedupe_hash (account + date + amount + normalized
   description) is deliberately strict — it's the last line of
   defence against silently re-importing the same statement twice.
   But it has a real false-positive shape: two genuinely separate
   purchases at the same place, same day, same amount, with a generic
   bank-printed description that carries no transaction-specific
   detail (two $100 Costco runs; two Food Lion trips). The fuzzy flag
   already surfaces these for a human to look at; this is what "I
   looked, it's not a duplicate" actually does about it — a conscious,
   per-row, audited override, not a change to the constraint itself.
   A normal "Approve selected"/"Approve all" still hits the same wall
   for an actual accidental re-import, exactly as before.
   ------------------------------------------------------------------ */

router.post('/:id/staged/:sid/approve-anyway', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sid = Number(req.params.sid);

    const { rows: batches } = await query('SELECT * FROM import_batch WHERE id = $1', [id]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import not found' });
    const batch = batches[0];

    if (batch.status === 'NEEDS_ACCOUNT' || batch.account_id == null) {
      return res.status(409).json({ error: 'Confirm which account this statement belongs to first' });
    }

    const { rows: staged } = await query(
      `SELECT * FROM staged_transaction WHERE id = $1 AND import_batch_id = $2 AND review_status = 'PENDING'`,
      [sid, id]
    );
    if (staged.length === 0) {
      return res.status(404).json({ error: 'Staged row not found or already reviewed' });
    }
    const row = staged[0];

    if (row.posted_date === null || row.description === null || row.amount_cents === null) {
      return res.status(422).json({ error: 'This row is missing a date, description or amount' });
    }

    const { rows: categories } = await query('SELECT id, name FROM category');
    const categoryId = categories.find((c) => c.name === row.suggested_category)?.id ?? null;
    const { rows: people } = await query('SELECT name FROM person');

    // Same identity fields as the normal hash, plus the staged row's
    // own id — a real, always-unique, database-generated value — so
    // this exact row can never collide with anything, including a
    // second force-approved row that happens to share every other
    // field. The normal (non-forced) hash is untouched for every
    // other approval path, so a genuine accidental re-import is still
    // caught there.
    const dedupeHash = createHash('sha256')
      .update(
        `${batch.account_id}|${row.posted_date}|${row.amount_cents}|${normalizeDescription(row.description)}|forced:${row.id}`
      )
      .digest('hex');

    const transactionId = await withTransaction(async (client) => {
      const { rows: inserted } = await client.query(
        `INSERT INTO transaction
           (account_id, import_batch_id, posted_date, description, merchant,
            amount_cents, txn_type, category_id, dedupe_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          batch.account_id,
          id,
          row.posted_date,
          row.description,
          row.merchant,
          row.amount_cents,
          row.txn_type,
          categoryId,
          dedupeHash,
        ]
      );

      await client.query(
        `UPDATE staged_transaction SET review_status = 'APPROVED', transaction_id = $2 WHERE id = $1`,
        [row.id, inserted[0].id]
      );

      await client.query(
        `UPDATE import_batch SET status = 'APPROVED', rows_approved = rows_approved + 1, approved_at = now()
          WHERE id = $1`,
        [id]
      );

      // Merchant cleanup before recurring-matching — see the other
      // approval path's own comment on this ordering above.
      await flagOrFixMerchants([inserted[0].id], client);
      await matchNewTransactions([inserted[0].id], client);

      // Same automatic Zelle classification as the normal approval
      // path — see its own comment there.
      if (/zelle/i.test(row.description)) {
        await applyZelleReview(client, {
          id: inserted[0].id,
          ...autoZelleReview(row.description, row.amount_cents, people),
        });
      }

      return inserted[0].id;
    });

    await audit({
      action: 'transaction.approved_despite_duplicate',
      entityType: 'transaction',
      entityId: transactionId,
      detail: {
        staged_id: row.id,
        posted_date: row.posted_date,
        description: row.description,
        amount_cents: row.amount_cents,
        matched_transaction_id: row.duplicate_of_id,
      },
    });

    res.json({ id: transactionId, staged_id: row.id, status: 'APPROVED' });
  } catch (err) {
    next(err);
  }
});

