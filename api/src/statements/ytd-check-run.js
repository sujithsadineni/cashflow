/**
 * The year-to-date check for every card statement (D346 step 1c): the I/O
 * around facts/ytd.js. Each statement against the one before it on the same
 * card. A statement missing in between (more than a few days between one's
 * end and the next's start) can't be checked: its fees would land in the
 * difference, so it's reported as the gap it is, not as a wrong figure.
 */
import { query } from '../core/db.js';
import { ytdAddsUp, periodCharges } from './facts/ytd.js';

const GAP_DAYS = 5;
const DAY_MS = 86_400_000;

/** Map of statement id → { fees, interest, gap } (fees / interest: true, false or null). */
export async function ytdChecks(db = { query }) {
  const { rows: statements } = await db.query(
    `SELECT s.id, s.account_id, s.import_batch_id, s.period_start::text AS period_start, s.period_end::text AS period_end,
            s.ytd_fees_cents, s.ytd_interest_cents
       FROM statement s JOIN account a ON a.id = s.account_id
      WHERE a.account_type = 'CREDIT_CARD' ORDER BY s.account_id, s.period_end`);
  const { rows: charges } = await db.query(
    `SELECT t.import_batch_id, t.txn_type, t.amount_cents, t.description, c.name AS category_name
       FROM transaction t JOIN account a ON a.id = t.account_id LEFT JOIN category c ON c.id = t.category_id
      WHERE a.account_type = 'CREDIT_CARD' AND t.txn_type IN ('fee', 'interest', 'refund')`);
  const byBatch = new Map();
  for (const r of charges) byBatch.set(r.import_batch_id, [...(byBatch.get(r.import_batch_id) ?? []), r]);

  const out = new Map();
  let previous = null;
  for (const s of statements) {
    const prev = previous?.account_id === s.account_id ? previous : null;
    previous = s;
    if (s.ytd_fees_cents == null && s.ytd_interest_cents == null) continue;
    const gap = prev != null && (Date.parse(s.period_start) - Date.parse(prev.period_end)) / DAY_MS > GAP_DAYS;
    if (prev == null || gap) { out.set(s.id, { fees: null, interest: null, gap }); continue; }
    const year = (x) => Number(x.period_end.slice(0, 4));
    const result = ytdAddsUp({ ...s, year: year(s) }, { ...prev, year: year(prev) }, periodCharges(byBatch.get(s.import_batch_id) ?? []));
    if (result) out.set(s.id, { ...result, gap: false });
  }
  return out;
}
