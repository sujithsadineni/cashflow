/**
 * Runs the payment matcher (payment-match.js, D199) against the database
 * and saves the links. Re-runnable: 'auto' rows for the cards being run
 * are replaced, 'manual' ones are never touched, and bank rows already
 * linked to other cards' payments stay theirs. One audit entry per run
 * with every change in it, the way the Review re-check does.
 */

import { query, withTransaction } from './db.js';
import { audit } from './audit.js';
import { explainUnlinkedBills, matchPayments } from './payment-match.js';

/**
 * @param accountIds  card account ids to match; omit for every card
 * @param dry         compute and return, write nothing
 */
export async function runPaymentMatch({ accountIds = null, dry = false } = {}) {
  const { rows: payments } = await query(
    `SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.description, a.issuer
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN category c ON c.id = t.category_id
      WHERE a.account_type = 'CREDIT_CARD' AND t.amount_cents > 0
        -- An ATM cash payment some statements saved as a 'deposit' (D200) is still a payment.
        AND (t.txn_type = 'payment' OR c.name = 'Card Payment' OR t.description ~* '(ATM|CASH|BRANCH) PAYMENT')
        AND ($1::int[] IS NULL OR t.account_id = ANY($1))
        AND NOT EXISTS (SELECT 1 FROM payment_match m WHERE m.card_transaction_id = t.id AND m.source = 'manual')
      ORDER BY t.posted_date, t.id`,
    [accountIds]
  );
  const { rows: bankRows } = await query(
    `SELECT t.id, t.account_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.description, t.txn_type, c.name AS category_name,
            t.zelle_type, t.zelle_person, t.contact_id, COALESCE(ct.nickname, ct.name) AS contact_name
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN category c ON c.id = t.category_id
       LEFT JOIN contact ct ON ct.id = t.contact_id
      WHERE a.account_type <> 'CREDIT_CARD' AND t.amount_cents < 0`
  );
  const { rows: bankAccounts } = await query(
    `SELECT a.id, a.issuer, a.mask,
            COALESCE(json_agg(json_build_object('period_start', s.period_start, 'period_end', s.period_end))
                     FILTER (WHERE s.id IS NOT NULL), '[]') AS periods
       FROM account a
       LEFT JOIN statement s ON s.account_id = a.id AND s.period_start IS NOT NULL AND s.period_end IS NOT NULL
      WHERE a.account_type IN ('CHECKING', 'SAVINGS') AND a.is_active
      GROUP BY a.id
      -- An account with no statements at all (a hand-entered balance, D180)
      -- can never be covered, so it would keep every payment unverifiable.
     HAVING COUNT(s.id) > 0`
  );
  const ids = payments.map((p) => p.id);
  const { rows: takenRows } = await query(
    `SELECT pp.transaction_id FROM payment_match_part pp JOIN payment_match m ON m.id = pp.match_id
      WHERE NOT (m.card_transaction_id = ANY($1)) OR m.source = 'manual'`,
    [ids]
  );

  const matches = matchPayments({ payments, bankRows, bankAccounts, taken: takenRows.map((r) => r.transaction_id) });
  const summary = {
    accounts: accountIds,
    payments: matches.length,
    verified: matches.filter((m) => m.status === 'verified').length,
    by_person: matches.filter((m) => m.via === 'person').length,
    cash: matches.filter((m) => m.via === 'cash').length,
    named: matches.filter((m) => m.status === 'named').length,
    statement_missing: matches.filter((m) => m.reason === 'statement_missing').length,
    no_match: matches.filter((m) => m.reason === 'no_match').length,
    ambiguous: matches.filter((m) => m.reason === 'ambiguous').length,
  };
  if (dry) return { summary, matches };

  const changed = await withTransaction(async (client) => {
    const { rows: before } = await client.query(
      `SELECT m.card_transaction_id, m.bank_transaction_id, m.status, m.reason, m.via,
              COALESCE(array_agg(pp.transaction_id ORDER BY pp.transaction_id) FILTER (WHERE pp.transaction_id IS NOT NULL), '{}') AS part_ids
         FROM payment_match m LEFT JOIN payment_match_part pp ON pp.match_id = m.id
        WHERE m.card_transaction_id = ANY($1) AND m.source = 'auto'
        GROUP BY m.id`,
      [ids]
    );
    const was = new Map(before.map((r) => [r.card_transaction_id, r]));
    // Clear the old bank links first so a link that moves between payments
    // in this run can't trip the UNIQUE constraint midway.
    await client.query(
      `DELETE FROM payment_match_part WHERE match_id IN (SELECT id FROM payment_match WHERE card_transaction_id = ANY($1) AND source = 'auto')`,
      [ids]
    );
    await client.query(
      `UPDATE payment_match SET bank_transaction_id = NULL, status = 'unverified', reason = 'no_match', via = 'bank'
        WHERE card_transaction_id = ANY($1) AND source = 'auto'`,
      [ids]
    );
    const out = [];
    for (const m of matches) {
      const { rows: saved } = await client.query(
        `INSERT INTO payment_match (card_transaction_id, bank_transaction_id, status, reason, via, detail)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (card_transaction_id) DO UPDATE
           SET bank_transaction_id = EXCLUDED.bank_transaction_id, status = EXCLUDED.status, reason = EXCLUDED.reason,
               via = EXCLUDED.via, detail = EXCLUDED.detail, checked_at = now()
           WHERE payment_match.source = 'auto'
         RETURNING id`,
        [m.card_transaction_id, m.bank_transaction_id, m.status, m.reason, m.via, m.detail]
      );
      for (const part of m.part_ids) {
        await client.query('INSERT INTO payment_match_part (match_id, transaction_id) VALUES ($1, $2)', [saved[0].id, part]);
      }
      const old = was.get(m.card_transaction_id);
      const parts = [...m.part_ids].sort((a, b) => a - b);
      if (!old || old.via !== m.via || old.status !== m.status || old.reason !== m.reason || String(old.part_ids) !== String(parts)) {
        out.push({ card: m.card_transaction_id, from: old ? { via: old.via, parts: old.part_ids, status: old.status, reason: old.reason } : null, to: { via: m.via, parts, status: m.status, reason: m.reason } });
      }
    }
    return out;
  });
  await audit({ action: 'payment_match.run', detail: { ...summary, changed } });
  const newly = (status) => changed.filter((c) => c.to.status === status && c.from?.status !== status).length;
  return { summary: { ...summary, changed: changed.length, newly_verified: newly('verified'), newly_named: newly('named') }, matches };
}

/**
 * After a statement is approved: re-match every card, so a newly uploaded
 * bank statement verifies the payments that were waiting on it, and a new
 * card statement's payments get traced.
 */
export function rematchAllCards() {
  return runPaymentMatch();
}

/**
 * What Review's Payments tab shows (D199 step 3): card payments not yet
 * traced to a bank (with the same fields the table's payment_source has),
 * and bank card bills no card payment matched, grouped by card and month.
 */
export async function loadPaymentReview() {
  const { rows: payments } = await query(
    `SELECT t.id AS transaction_id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.description,
            a.name AS account_name, a.mask AS account_mask, a.issuer AS account_issuer,
            json_build_object(
              'status', m.status, 'reason', m.reason, 'source', m.source, 'via', m.via, 'bank', NULL,
              'named_issuer', m.detail->>'named_issuer',
              'likely', CASE WHEN la.id IS NULL THEN NULL ELSE json_build_object(
                'account_id', la.id, 'account_name', la.name, 'account_type', la.account_type, 'issuer', la.issuer, 'mask', la.mask,
                'accounts_at_bank', (SELECT COUNT(*)::int FROM account x WHERE x.issuer = la.issuer AND x.account_type <> 'CREDIT_CARD'))
              END,
              'covered_from', m.detail->>'covered_from', 'covered_until', m.detail->>'covered_until', 'window', m.detail->'window',
              'candidate_count', jsonb_array_length(COALESCE(m.detail->'candidate_ids', '[]'::jsonb))) AS payment_source
       FROM payment_match m
       JOIN transaction t ON t.id = m.card_transaction_id
       JOIN account a ON a.id = t.account_id
       LEFT JOIN account la ON la.id = (m.detail->>'likely_account_id')::int
      WHERE m.status IN ('unverified', 'named')
      ORDER BY t.posted_date DESC, t.id DESC`
  );
  const { rows: bills } = await query(
    `SELECT t.id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, t.amount_cents, t.description
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN category c ON c.id = t.category_id
      WHERE a.account_type <> 'CREDIT_CARD' AND t.amount_cents < 0
        AND (c.name = 'Card Payment' OR (t.txn_type = 'payment' AND COALESCE(c.name, '') <> 'Loan'))
        AND NOT EXISTS (SELECT 1 FROM payment_match_part pp WHERE pp.transaction_id = t.id)`
  );
  const { rows: cards } = await query(
    `SELECT a.id, a.name, a.issuer, a.mask,
            COALESCE(json_agg(json_build_object('period_start', s.period_start, 'period_end', s.period_end))
                     FILTER (WHERE s.id IS NOT NULL), '[]') AS periods
       FROM account a
       LEFT JOIN statement s ON s.account_id = a.id AND s.period_start IS NOT NULL AND s.period_end IS NOT NULL
      WHERE a.account_type = 'CREDIT_CARD'
      GROUP BY a.id`
  );
  return { payments, card_bills: explainUnlinkedBills({ bills, cards }) };
}
