/**
 * Possible duplicate transactions (D328): the same purchase saved from two
 * statements. The pairs are worked out from the ledger on every request
 * (review/duplicates.js) and scored from the evidence (review/duplicate-score.js:
 * the re-read PDF, the statement's balances), so they're never stale; duplicate_review only
 * remembers "both are real". Removing a copy deletes it by D43's path for
 * an undone import: it never happened, so it isn't history to keep, and
 * the audit entry holds the whole row.
 */

import { Router } from 'express';
import { query, withTransaction } from '../core/db.js';
import { audit } from '../core/audit.js';
import { validate, duplicatePairSchema as pairSchema } from '../core/validate.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findDuplicatePairs, pairKey, inOwnPeriod } from '../review/duplicates.js';
import { scoreDuplicate } from '../review/duplicate-score.js';
import { statementTally } from '../statements/tally.js';
import { extractStatementFromPdfLocally } from '../parse/pdf-local.js';
import { REPO_ROOT } from './imports/shared.js';
import { runPaymentMatch } from '../matching/payment-match-run.js';
import { rematchTransfers } from '../matching/transfer-match-run.js';

export const duplicatesRouter = Router();

/**
 * What a re-read of an import's PDF prints, as "date|cents" counts (D329).
 * Cached per import and file: a statement's PDF doesn't change. null when
 * the free reader can't open or read it (a locked file, an unknown layout).
 */
const printedCache = new Map();
async function printedRows(batch) {
  const key = `${batch.id}:${batch.file_hash}`;
  if (printedCache.has(key)) return printedCache.get(key);
  let counts = null;
  try {
    const parsed = await extractStatementFromPdfLocally(await readFile(path.resolve(REPO_ROOT, batch.stored_path)), []);
    if (parsed.ok) {
      counts = new Map();
      for (const r of parsed.rows) counts.set(`${r.posted_date}|${r.amount_cents}`, (counts.get(`${r.posted_date}|${r.amount_cents}`) ?? 0) + 1);
    }
  } catch {
    counts = null;
  }
  printedCache.set(key, counts);
  return counts;
}

async function loadPairs() {
  const { rows } = await query(
    `SELECT t.id, t.account_id, t.import_batch_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date,
            t.amount_cents, t.description, t.merchant, t.txn_type,
            to_char(s.period_start, 'YYYY-MM-DD') AS period_start, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
            a.name AS account_name, a.mask AS account_mask
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN statement s ON s.import_batch_id = t.import_batch_id`
  );
  const { rows: answered } = await query('SELECT transaction_a_id AS a, transaction_b_id AS b FROM duplicate_review');
  const settled = new Set(answered.map((r) => pairKey(r.a, r.b)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const candidates = findDuplicatePairs(rows, settled);
  if (candidates.length === 0) return { pairs: [], byId };

  // The evidence, for the imports the candidates came from.
  const batchIds = [...new Set(candidates.flatMap((c) => [byId.get(c.a_id).import_batch_id, byId.get(c.b_id).import_batch_id]))];
  const { rows: batches } = await query(
    `SELECT b.id, b.stored_path, b.file_type, b.file_hash, a.account_type, s.opening_balance_cents, s.closing_balance_cents,
            (SELECT COALESCE(SUM(t.amount_cents), 0) FROM transaction t WHERE t.import_batch_id = b.id) AS saved_cents
       FROM import_batch b JOIN account a ON a.id = b.account_id LEFT JOIN statement s ON s.import_batch_id = b.id
      WHERE b.id = ANY($1)`,
    [batchIds]
  );
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const savedCount = (batchId, row) => rows.filter((r) => r.import_batch_id === batchId && r.posted_date === row.posted_date && r.amount_cents === row.amount_cents).length;

  const facts = async (row) => {
    const b = batchById.get(row.import_batch_id);
    const printed = b.file_type === 'PDF' ? await printedRows(b) : null;
    const tally = (cents) => statementTally({ accountType: b.account_type, openingCents: b.opening_balance_cents, closingCents: b.closing_balance_cents, rows: [{ amount_cents: cents }] }).status;
    const withIt = tally(Number(b.saved_cents));
    const without = tally(Number(b.saved_cents) - row.amount_cents);
    return {
      id: row.id,
      // Printed as many times as it's saved from that statement (two real twins need two lines).
      printed: printed ? (printed.get(`${row.posted_date}|${row.amount_cents}`) ?? 0) >= savedCount(b.id, row) : null,
      needed: withIt === 'unknown' ? null : withIt === 'match' && without === 'mismatch',
      spare: withIt === 'unknown' ? null : withIt === 'mismatch' && without === 'match',
      in_period: inOwnPeriod(row),
    };
  };

  const pairs = [];
  for (const c of candidates) {
    const scored = scoreDuplicate({ ...c, a: await facts(byId.get(c.a_id)), b: await facts(byId.get(c.b_id)) });
    const keep_id = scored.remove_id === c.a_id ? c.b_id : c.a_id;
    pairs.push({ ...c, ...scored, keep_id });
  }
  pairs.sort((x, y) => y.score - x.score || x.a_id - y.a_id);
  return { pairs, byId };
}

/** The pair as it stands now, or null: only a listed pair can be answered. */
async function currentPair(aId, bId) {
  const { pairs, byId } = await loadPairs();
  const pair = pairs.find((p) => pairKey(p.a_id, p.b_id) === pairKey(aId, bId));
  return pair ? { pair, byId } : null;
}

duplicatesRouter.get('/', async (req, res, next) => {
  try {
    const { pairs, byId } = await loadPairs();
    // A copy approved past the import-time flag says so: it was a choice once,
    // but it meant "this row belongs here", not "both are real" (D328).
    const ids = pairs.flatMap((p) => [p.a_id, p.b_id]);
    const { rows: anyway } = ids.length
      ? await query(
          `SELECT entity_id, created_at FROM audit_log WHERE action = 'transaction.approved_despite_duplicate' AND entity_id = ANY($1)`,
          [ids]
        )
      : { rows: [] };
    const approvedAnyway = new Map(anyway.map((r) => [r.entity_id, r.created_at]));
    const side = (id) => ({ ...byId.get(id), approved_anyway_at: approvedAnyway.get(id) ?? null, checks: undefined });
    res.json(pairs.map((p) => ({ ...p, a: side(p.a_id), b: side(p.b_id) })));
  } catch (err) {
    next(err);
  }
});

duplicatesRouter.get('/count', async (req, res, next) => {
  try {
    const { pairs } = await loadPairs();
    // The badge counts what's worth a look: a proven duplicate or a likely guess.
    res.json({ count: pairs.filter((p) => p.score >= 50).length, candidates: pairs.length });
  } catch (err) {
    next(err);
  }
});

duplicatesRouter.post('/both-real', validate(pairSchema), async (req, res, next) => {
  try {
    const { keep_id, remove_id } = req.body;
    const found = await currentPair(keep_id, remove_id);
    if (!found) return res.status(404).json({ error: 'That pair is no longer a possible duplicate' });
    const [a, b] = keep_id < remove_id ? [keep_id, remove_id] : [remove_id, keep_id];
    const { rows } = await query(
      `INSERT INTO duplicate_review (transaction_a_id, transaction_b_id) VALUES ($1, $2)
       ON CONFLICT (transaction_a_id, transaction_b_id) DO NOTHING RETURNING id`,
      [a, b]
    );
    await audit({
      action: 'duplicate.both_real',
      entityType: 'transaction',
      entityId: a,
      detail: { transaction_ids: [a, b], score: found.pair.score, verdict: found.pair.verdict },
    });
    res.json({ id: rows[0]?.id ?? null, transaction_ids: [a, b] });
  } catch (err) {
    next(err);
  }
});

duplicatesRouter.post('/remove', validate(pairSchema), async (req, res, next) => {
  try {
    const { keep_id, remove_id } = req.body;
    const found = await currentPair(keep_id, remove_id);
    if (!found) return res.status(404).json({ error: 'That pair is no longer a possible duplicate' });
    // Only the copy the evidence points at: never one its statement needs (D329).
    if (found.pair.remove_id !== remove_id) {
      return res.status(409).json({ error: found.pair.remove_id == null
        ? 'Both copies are needed by their statements, so neither can be removed'
        : 'That copy is the one its statement needs; the other is the one to remove' });
    }
    const removed = found.byId.get(remove_id);

    const derived = await withTransaction(async (client) => {
      // Links first, as undoing an import does (D43, D227): payment matches on
      // the copy (their parts cascade), Review and merchant findings about it.
      // Transfer matches and duplicate answers cascade with the row itself.
      const { rows: matches } = await client.query(
        `SELECT DISTINCT m.id, t.account_id
           FROM payment_match m JOIN transaction t ON t.id = m.card_transaction_id
          WHERE m.card_transaction_id = $1 OR m.bank_transaction_id = $1
             OR m.id IN (SELECT match_id FROM payment_match_part WHERE transaction_id = $1)`,
        [remove_id]
      );
      await client.query('DELETE FROM payment_match WHERE id = ANY($1)', [matches.map((m) => m.id)]);
      await client.query('DELETE FROM transaction_review WHERE transaction_id = $1', [remove_id]);
      await client.query('DELETE FROM merchant_review WHERE transaction_id = $1', [remove_id]);
      // The staged row stays as the record of what the statement printed, but
      // rejected, so a re-check or "approve all" can't bring the copy back.
      const { rows: staged } = await client.query(
        `UPDATE staged_transaction SET review_status = 'REJECTED', transaction_id = NULL
          WHERE transaction_id = $1 RETURNING id, import_batch_id`,
        [remove_id]
      );
      await client.query('DELETE FROM transaction WHERE id = $1', [remove_id]);
      if (removed.import_batch_id != null) {
        await client.query(
          `UPDATE import_batch SET rows_approved = (SELECT COUNT(*) FROM transaction WHERE import_batch_id = $1) WHERE id = $1`,
          [removed.import_batch_id]
        );
      }
      await audit({
        action: 'transaction.duplicate_removed',
        entityType: 'transaction',
        entityId: remove_id,
        detail: {
          kept_transaction_id: keep_id,
          score: found.pair.score,
          verdict: found.pair.verdict,
          removed,
          staged_ids: staged.map((s) => s.id),
          payment_matches_removed: matches.length,
        },
        client,
      });
      return { cards: [...new Set(matches.map((m) => m.account_id))] };
    });

    // Best-effort, as after an undone import: the removal already stands.
    if (derived.cards.length > 0) {
      await runPaymentMatch({ accountIds: derived.cards }).catch((err) => req.log?.warn({ err }, 'payment re-match after duplicate removal failed'));
    }
    await rematchTransfers().catch((err) => req.log?.warn({ err }, 'transfer re-match after duplicate removal failed'));

    res.json({ removed_id: remove_id, kept_id: keep_id });
  } catch (err) {
    next(err);
  }
});
