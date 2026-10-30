/**
 * Links every transfer's two halves (D265), after each import approval,
 * import delete and "Re-check all". 'auto' links are rebuilt from scratch
 * each run; a 'manual' link, and both rows it holds, are left alone.
 */

import { query, withTransaction } from '../core/db.js';
import { audit } from '../core/audit.js';
import { matchTransfers, MOVING } from './transfer-match.js';

export async function rematchTransfers() {
  const { rows } = await query(
    `SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.txn_type
       FROM transaction t
      WHERE t.txn_type = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM transfer_match m
                         WHERE m.source = 'manual' AND t.id IN (m.out_transaction_id, m.in_transaction_id))`,
    [[...MOVING]]
  );
  const pairs = matchTransfers(rows);
  const key = (p) => `${p.out_transaction_id}|${p.in_transaction_id}`;

  const summary = await withTransaction(async (client) => {
    const { rows: before } = await client.query(`SELECT out_transaction_id, in_transaction_id FROM transfer_match WHERE source = 'auto'`);
    const had = new Set(before.map(key));
    const now = new Set(pairs.map(key));
    await client.query(`DELETE FROM transfer_match WHERE source = 'auto'`);
    for (const p of pairs) {
      await client.query(
        `INSERT INTO transfer_match (out_transaction_id, in_transaction_id) VALUES ($1, $2)`,
        [p.out_transaction_id, p.in_transaction_id]
      );
    }
    return {
      pairs: pairs.length,
      added: [...now].filter((k) => !had.has(k)).length,
      removed: [...had].filter((k) => !now.has(k)).length,
    };
  });

  if (summary.added || summary.removed) await audit({ action: 'transfer_match.run', detail: summary });
  return summary;
}
