/**
 * Approve staged rows into transactions, and approve one past the duplicate check.
 * Split out of routes/imports.js (D213); mounted under /api/imports.
 */

import { createHash } from 'node:crypto';

import { Router } from 'express';

import { query, withTransaction } from '../../core/db.js';
import { audit } from '../../core/audit.js';
import { validate, approveSchema } from '../../core/validate.js';
import { autoZelleReview } from '../../matching/zelle.js';
import { applyZelleReview } from '../zelle.js';
import { runRecheck, markVerification } from '../transaction-review.js';
import { rematchAllCards } from '../../matching/payment-match-run.js';
import { rematchTransfers } from '../../matching/transfer-match-run.js';
import { learnCardDays } from '../../statements/card-dates-run.js';
import { learnMailingAddress, readStatementAddress } from '../../statements/mailing-address-run.js';
import { readMemberSince } from '../../statements/member-since-run.js';
import { matchNewTransactions, getSuggestions } from '../recurring.js';
import { flagOrFixMerchants } from '../../review/merchant-review.js';
import { fileSpenders } from '../../statements/spender-run.js';

const router = Router();
export { router as approveRouter };

/* ------------------------------------------------------------------
   Approve — move staged rows into the permanent record
   ------------------------------------------------------------------ */

const normalizeDescription = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The dedupe hash (D13) for each staged row of a batch. Two identical rows
 * printed on ONE statement are both real (the same purchase made twice
 * for a 5%-back offer, D328), so the second and later get their place on the
 * statement in the hash ("|2", "|3"). The first keeps the plain hash, so a
 * second upload of the same statement still collides on every row.
 * Counted over all of the batch's rows by id, so approving in parts gives
 * the same answer as approving all.
 */
async function dedupeHashes(client, batch) {
  const { rows } = await client.query(
    `SELECT id, posted_date, amount_cents, description FROM staged_transaction
      WHERE import_batch_id = $1 AND posted_date IS NOT NULL AND amount_cents IS NOT NULL AND description IS NOT NULL
      ORDER BY id`,
    [batch.id]
  );
  const seen = new Map();
  const hashes = new Map();
  for (const r of rows) {
    const key = `${batch.account_id}|${r.posted_date}|${r.amount_cents}|${normalizeDescription(r.description)}`;
    const place = (seen.get(key) ?? 0) + 1;
    seen.set(key, place);
    hashes.set(r.id, createHash('sha256').update(place === 1 ? key : `${key}|${place}`).digest('hex'));
  }
  return hashes;
}

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

    // A statement read with no rows at all (an untouched card, D273) is approved as it
    // is: that marks it done and runs the follow-ups. A batch whose rows were all
    // approved already still has nothing to approve.
    // Every line skipped (D335) is the same: nothing to save, but the statement is done.
    const { rows: [{ skipped }] } = await query(
      `SELECT COUNT(*) FILTER (WHERE review_status = 'REJECTED')::int AS skipped FROM staged_transaction WHERE import_batch_id = $1`, [id]);
    const emptyStatement = staged.length === 0 && all === true && batch.status === 'REVIEW' && (Number(batch.rows_parsed) === 0 || skipped > 0);
    if (staged.length === 0 && !emptyStatement) {
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
    // What approving found, for the success toasts (D317).
    let billsLinked = [];
    let approvedIds = [];
    try {
      approvedCount = await withTransaction(async (client) => {
        const insertedIds = [];
        const hashes = await dedupeHashes(client, batch);

        for (const row of staged) {
          failing = row;
          const dedupeHash = hashes.get(row.id);

          const { rows: inserted } = await client.query(
            `INSERT INTO transaction
               (account_id, import_batch_id, posted_date, description, merchant,
                amount_cents, txn_type, category_id, dedupe_hash, spender_name, card_ending)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
              row.spender_name,
              row.card_ending,
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
          // correct any row this gets wrong. See api/src/matching/zelle.js.
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

        // Who spent each row on a shared card, from its statement section (D344). After the
        // merchant cleanup: a refund finds the purchase it gives back by merchant.
        await fileSpenders(client, batch.account_id, insertedIds);

        // Confirmed recurring rules catch their own future transactions
        // from here on, without re-running detection — see routes/recurring.js.
        billsLinked = await matchNewTransactions(insertedIds, client);
        approvedIds = insertedIds;

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
      // And links a transfer's two halves, which a new statement may complete (D265).
      const transfers = await rematchTransfers();
      // A card without closing and due days yet learns them from this statement (D270).
      const cardDays = await learnCardDays(batch.account_id);
      // And the mailing address its first page prints, when it's the newest statement (D302).
      await learnMailingAddress(batch.account_id);
      // And this statement's own, for the person's address history (D303).
      const address = await readStatementAddress(batch.id);
      // And the "Member since" it prints, so months before the account read as before it (D393).
      await readMemberSince(batch.id);
      // A bill this statement's rows now show repeating, not yet a bill (D317).
      const fresh = new Set(approvedIds);
      const newBills = approvedIds.length
        ? (await getSuggestions()).filter((s) => s.charges?.some((c) => fresh.has(c.id))).map((s) => s.name)
        : [];
      follow_up = {
        review_added: review.added,
        payments_verified: summary.newly_verified,
        payments_named: summary.newly_named,
        payments_unknown: summary.payments - summary.verified - summary.named,
        transfers_linked: transfers.added,
        bills_linked: billsLinked,
        new_bills: newBills,
        card_days_learned: Boolean(cardDays),
        address_read: address === 'updated',
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
            amount_cents, txn_type, category_id, dedupe_hash, spender_name, card_ending)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
          row.spender_name,
          row.card_ending,
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
      await fileSpenders(client, batch.account_id, [inserted[0].id]);
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

