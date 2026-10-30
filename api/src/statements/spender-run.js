/**
 * Files who spent each row on a shared card (D344): the I/O around
 * spender.js. Used when a statement is approved, when a member is added or
 * changed, and by the backfill that re-reads stored statements.
 */
import { resolveSpender, originalPurchase } from './spender.js';

/** The card's members and every last four the account itself has been printed with. */
export async function spenderContext(db, accountId) {
  const { rows: members } = await db.query(
    `SELECT id, person_id, role, printed_name, card_ending, since, is_active FROM account_member WHERE account_id = $1 ORDER BY id`,
    [accountId]
  );
  const { rows: masks } = await db.query(
    `SELECT mask FROM account WHERE id = $1 AND mask IS NOT NULL
     UNION SELECT card_mask FROM statement WHERE account_id = $1 AND card_mask IS NOT NULL`,
    [accountId]
  );
  return { members, ownMasks: masks.map((m) => m.mask) };
}

/**
 * Works out spender_person_id for the account's rows (`ids`, or all of them
 * when null) and writes the ones that change. Purchases and other tagged rows
 * first, from their printed section; then refunds, which follow the purchase
 * they give back and fall back to their own section.
 * Returns [{ id, from, to }], the changes made, for the audit entry.
 */
export async function fileSpenders(db, accountId, ids = null) {
  const ctx = await spenderContext(db, accountId);
  const { rows } = await db.query(
    `SELECT id, posted_date::text AS posted_date, amount_cents, merchant, description, txn_type,
            spender_name, card_ending, spender_person_id
       FROM transaction
      WHERE account_id = $1 AND ($2::int[] IS NULL OR id = ANY($2))
      ORDER BY posted_date, id`,
    [accountId, ids]
  );
  const changes = [];
  const set = async (row, to) => {
    if ((row.spender_person_id ?? null) === to) return;
    await db.query(`UPDATE transaction SET spender_person_id = $2, updated_at = now() WHERE id = $1`, [row.id, to]);
    changes.push({ id: row.id, from: row.spender_person_id ?? null, to });
    row.spender_person_id = to;
  };

  for (const row of rows.filter((r) => r.txn_type !== 'refund')) {
    await set(row, resolveSpender(row, ctx).personId);
  }

  const refunds = rows.filter((r) => r.txn_type === 'refund');
  if (refunds.length > 0) {
    // Read after the purchases above were filed, so a refund on the same statement sees them.
    const { rows: purchases } = await db.query(
      `SELECT id, posted_date::text AS posted_date, amount_cents, merchant, description, spender_person_id
         FROM transaction
        WHERE account_id = $1 AND txn_type = 'purchase'
          AND posted_date BETWEEN $2::date - 180 AND $3::date`,
      [accountId, refunds[0].posted_date, refunds.at(-1).posted_date]
    );
    for (const refund of refunds) {
      const bought = originalPurchase(refund, purchases);
      await set(refund, bought ? bought.spender_person_id ?? null : resolveSpender(refund, ctx).personId);
    }
  }
  return changes;
}

/**
 * Names and card endings the account's statements print that no member
 * accounts for: what Settings proposes as a member (D100: proposed, never added).
 * Returns [{ printed_name, card_ending, rows, first, last }].
 */
export async function proposedMembers(db, accountId) {
  const ctx = await spenderContext(db, accountId);
  const { rows } = await db.query(
    `SELECT spender_name AS printed_name, card_ending, count(*)::int AS rows,
            min(posted_date)::text AS first, max(posted_date)::text AS last
       FROM transaction
      WHERE account_id = $1 AND spender_person_id IS NULL AND (spender_name IS NOT NULL OR card_ending IS NOT NULL)
      GROUP BY 1, 2 ORDER BY min(posted_date)`,
    [accountId]
  );
  return rows.filter((r) => resolveSpender({ spender_name: r.printed_name, card_ending: r.card_ending }, ctx).proposed);
}
