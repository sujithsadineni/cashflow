/**
 * Loads what statement-gaps.js judges (D268), from the database: every
 * open credit card, its statements and imports, the bank rows that pay a
 * card issuer, annual fees falling due, and the household's "No
 * statement this month" answers.
 */

import { query } from '../core/db.js';
import { judgeStatementGaps, addMonths } from './statement-gaps.js';
import { issuerKey, issuerNamedBy } from '../matching/payment-match.js';

export async function loadStatementGaps({ today = new Date().toISOString().slice(0, 10) } = {}) {
  const { rows: cards } = await query(
    `SELECT id, name, issuer, mask FROM account WHERE account_type = 'CREDIT_CARD' AND is_active ORDER BY name, id`
  );
  if (cards.length === 0) return [];
  const ids = cards.map((c) => c.id);

  const [{ rows: statements }, { rows: imports }, { rows: bank }, { rows: fees }, { rows: answers }] = await Promise.all([
    query(
      `SELECT s.account_id, s.id AS statement_id, s.import_batch_id,
              to_char(s.period_start, 'YYYY-MM-DD') AS period_start, to_char(s.period_end, 'YYYY-MM-DD') AS period_end,
              s.opening_balance_cents, s.closing_balance_cents,
              -- A statement for an untouched card (D273): no rows came from it and its balance didn't move.
              (s.import_batch_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM transaction t WHERE t.import_batch_id = s.import_batch_id)
                 AND s.opening_balance_cents IS NOT DISTINCT FROM s.closing_balance_cents) AS no_activity
         FROM statement s
        WHERE s.account_id = ANY($1) AND s.period_start IS NOT NULL AND s.period_end IS NOT NULL`,
      [ids]
    ),
    query(
      `SELECT b.account_id, b.id AS import_batch_id,
              to_char(MIN(t.posted_date), 'YYYY-MM-DD') AS first_date, to_char(MAX(t.posted_date), 'YYYY-MM-DD') AS last_date,
              EXISTS (SELECT 1 FROM statement s WHERE s.import_batch_id = b.id AND s.period_end IS NOT NULL) AS has_statement,
              b.file_type
         FROM import_batch b JOIN transaction t ON t.import_batch_id = b.id
        WHERE b.account_id = ANY($1)
        GROUP BY b.id`,
      [ids]
    ),
    // Card bills paid from a bank account, and which card's statement, if any, already explains each.
    query(
      `SELECT t.id, to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, -t.amount_cents AS amount_cents, t.description,
              a.name AS account_name,
              COALESCE(
                (SELECT ct.account_id FROM payment_match m JOIN transaction ct ON ct.id = m.card_transaction_id WHERE m.bank_transaction_id = t.id),
                (SELECT ct.account_id FROM payment_match_part p JOIN payment_match m ON m.id = p.match_id
                   JOIN transaction ct ON ct.id = m.card_transaction_id WHERE p.transaction_id = t.id LIMIT 1)
              ) AS explained_by_card_id
         FROM transaction t JOIN account a ON a.id = t.account_id
        WHERE a.account_type <> 'CREDIT_CARD' AND t.amount_cents < 0 AND t.txn_type = 'payment'`
    ),
    query(
      `SELECT t.account_id, to_char(MAX(t.posted_date), 'YYYY-MM-DD') AS last_fee
         FROM transaction t JOIN category c ON c.id = t.category_id
        WHERE t.account_id = ANY($1) AND c.name = 'Annual Fee' AND t.txn_type = 'fee' AND t.amount_cents < 0
        GROUP BY t.account_id`,
      [ids]
    ),
    query(`SELECT account_id, to_char(cycle_end, 'YYYY-MM-DD') AS cycle_end FROM statement_gap_answer`),
  ]);

  const payments = bank
    .map((p) => ({ ...p, amount_cents: Number(p.amount_cents), issuer_key: issuerNamedBy(p.description) }))
    .filter((p) => p.issuer_key);
  const expected = fees.map((f) => ({ account_id: f.account_id, date: addMonths(f.last_fee, 12), label: 'The yearly annual fee' }));

  const judged = judgeStatementGaps({
    cards: cards.map((c) => ({ ...c, issuer_key: issuerKey(c.issuer) })),
    statements,
    imports,
    payments,
    expected,
    answers,
    today,
  });
  const maskOf = new Map(cards.map((c) => [c.id, c.mask]));
  return judged.map((c) => ({ ...c, mask: maskOf.get(c.account_id) ?? null }));
}
