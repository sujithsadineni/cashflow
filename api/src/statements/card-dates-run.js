/**
 * Each card's closing and due days, what its statements suggest, and
 * where its newest bill stands (D270), from the database. Shared by the
 * accounts list, the alerts and the import approval.
 */

import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { suggestCardDays, cardDue } from './card-dates.js';
import { issuerKey, issuerNamedBy } from '../matching/payment-match.js';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** @returns Map(account_id → { closing_day, due_day, suggestion: { closing, due }, due }) for every card. */
export async function loadCardDates({ today = localToday(), accountIds = null } = {}) {
  const { rows: cards } = await query(
    `SELECT id, issuer, is_active, closing_day, due_day FROM account
      WHERE account_type = 'CREDIT_CARD' ${accountIds ? 'AND id = ANY($1)' : ''}`,
    accountIds ? [accountIds] : []
  );
  if (cards.length === 0) return new Map();
  const ids = cards.map((c) => c.id);
  const [{ rows: statements }, { rows: paid }, { rows: bankPays }, { rows: seen }, { rows: allCards }] = await Promise.all([
    query(
      `SELECT account_id, to_char(period_end, 'YYYY-MM-DD') AS period_end,
              to_char(payment_due_date, 'YYYY-MM-DD') AS payment_due_date,
              closing_balance_cents, minimum_payment_cents
         FROM statement WHERE account_id = ANY($1) ORDER BY period_end`,
      [ids]
    ),
    // Payments that posted on each card after its newest statement closed.
    query(
      `SELECT t.account_id, COALESCE(SUM(t.amount_cents), 0)::bigint AS cents
         FROM transaction t
         JOIN (SELECT account_id, MAX(period_end) AS last_end FROM statement WHERE account_id = ANY($1) GROUP BY account_id) s
           ON s.account_id = t.account_id
        WHERE t.txn_type = 'payment' AND t.amount_cents > 0 AND t.posted_date > s.last_end AND t.posted_date <= $2::date
        GROUP BY t.account_id`,
      [ids, today]
    ),
    // Bills paid from a bank, not matched to a card's statement row yet: a payment the card's next statement will show.
    query(
      `SELECT to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date, -t.amount_cents AS cents, t.description
         FROM transaction t JOIN account a ON a.id = t.account_id
        WHERE a.account_type <> 'CREDIT_CARD' AND t.txn_type = 'payment' AND t.amount_cents < 0 AND t.posted_date <= $1::date
          AND NOT EXISTS (SELECT 1 FROM payment_match m WHERE m.bank_transaction_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM payment_match_part p WHERE p.transaction_id = t.id)`,
      [today]
    ),
    // How far each card's payments can be seen: its own rows, and the banks that have paid it before.
    query(
      `SELECT c.id AS account_id,
              to_char(GREATEST((SELECT MAX(period_end) FROM statement WHERE account_id = c.id),
                               (SELECT MAX(posted_date) FROM transaction WHERE account_id = c.id)), 'YYYY-MM-DD') AS card_end,
              to_char((SELECT MIN(bank_end) FROM (
                         SELECT DISTINCT bt.account_id, (SELECT MAX(period_end) FROM statement WHERE account_id = bt.account_id) AS bank_end
                           FROM payment_match m JOIN transaction ct ON ct.id = m.card_transaction_id
                           JOIN transaction bt ON bt.id = m.bank_transaction_id
                          WHERE ct.account_id = c.id AND m.status = 'verified') payers), 'YYYY-MM-DD') AS payers_end
         FROM account c WHERE c.id = ANY($1)`,
      [ids]
    ),
    query(`SELECT id, issuer FROM account WHERE account_type = 'CREDIT_CARD' AND is_active`),
  ]);
  const seenBy = new Map(seen.map((s) => [s.account_id, [s.card_end, s.payers_end].filter(Boolean).sort().at(-1) ?? null]));
  const issuerCount = new Map();
  for (const c of allCards) issuerCount.set(issuerKey(c.issuer), (issuerCount.get(issuerKey(c.issuer)) ?? 0) + 1);
  const paidBy = new Map(paid.map((p) => [p.account_id, Number(p.cents)]));
  const out = new Map();
  for (const c of cards) {
    const mine = statements.filter((s) => s.account_id === c.id);
    const last = mine.at(-1) ?? null;
    // A bank payment to this card's issuer after the statement closed counts when it can only be for
    // this card: the issuer's only card, or it pays this statement's balance or minimum to the cent.
    const key = issuerKey(c.issuer);
    const owed = last?.closing_balance_cents ?? 0;
    const fromBank = !last ? 0 : bankPays
      .filter((p) => p.posted_date > last.period_end && issuerNamedBy(p.description) === key)
      .filter((p) => issuerCount.get(key) === 1 || Math.abs(Number(p.cents) - owed) <= 1 || Math.abs(Number(p.cents) - (last.minimum_payment_cents ?? -1)) <= 1)
      .reduce((n, p) => n + Number(p.cents), 0);
    out.set(c.id, {
      closing_day: c.closing_day,
      due_day: c.due_day,
      suggestion: suggestCardDays(mine),
      due: cardDue({ statement: last, paidCents: (paidBy.get(c.id) ?? 0) + fromBank, dueDay: c.due_day, today, seenUntil: seenBy.get(c.id) ?? null }),
    });
  }
  return out;
}

/**
 * A card with no closing or due day yet takes them from its statements
 * (D270): a new card is set up by its first statement. A day the
 * household set is never changed here; a different suggestion only
 * shows in the edit form. Audited. Returns what was set.
 */
export async function learnCardDays(accountId) {
  const dates = (await loadCardDates({ accountIds: [accountId] })).get(accountId);
  if (!dates) return null;
  const set = {};
  if (dates.closing_day == null && dates.suggestion.closing) set.closing_day = dates.suggestion.closing.day;
  if (dates.due_day == null && dates.suggestion.due) set.due_day = dates.suggestion.due.day;
  if (Object.keys(set).length > 0) {
    await query(
      `UPDATE account SET closing_day = COALESCE(closing_day, $2), due_day = COALESCE(due_day, $3) WHERE id = $1`,
      [accountId, set.closing_day ?? null, set.due_day ?? null]
    );
    await audit({ action: 'account.dates_learned', entityType: 'account', entityId: accountId, detail: { ...set, from: 'statements' } });
  }
  // A bank moves its days (Zolve went from the 14th to the 17th in July 2026,
  // D320): when the two newest statements agree on a day the account doesn't
  // have, the statements win. Two, so one odd short cycle doesn't move it.
  const moved = await movedCardDays(accountId, { closing_day: dates.closing_day ?? set.closing_day, due_day: dates.due_day ?? set.due_day });
  if (moved) {
    await query('UPDATE account SET closing_day = COALESCE($2, closing_day), due_day = COALESCE($3, due_day) WHERE id = $1', [accountId, moved.closing_day ?? null, moved.due_day ?? null]);
    await audit({ action: 'account.dates_changed', entityType: 'account', entityId: accountId, detail: { ...moved, from: 'statements' } });
  }
  const all = { ...set, ...(moved ?? {}) };
  return Object.keys(all).length ? all : null;
}

/** The days the two newest statements agree on, where they differ from the account's. */
export async function movedCardDays(accountId, current) {
  const { rows } = await query(
    `SELECT extract(day FROM period_end)::int AS closing, extract(day FROM payment_due_date)::int AS due
       FROM statement WHERE account_id = $1 AND period_end IS NOT NULL ORDER BY period_end DESC LIMIT 2`,
    [accountId]
  );
  return daysMoved(rows, current);
}

/** Pure: { closing_day?, due_day? } when both rows agree on a new day; null otherwise. Tested. */
export function daysMoved(rows, current) {
  if (rows.length < 2) return null;
  const out = {};
  const [a, b] = rows;
  if (a.closing && a.closing === b.closing && a.closing !== current.closing_day) out.closing_day = a.closing;
  if (a.due && a.due === b.due && a.due !== current.due_day) out.due_day = a.due;
  return Object.keys(out).length ? out : null;
}
