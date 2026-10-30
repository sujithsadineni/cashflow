/**
 * An account shows the card it is now (D414): the newest statement's last 4 and product, so a
 * reissued or upgraded card reads "Blue Cash Preferred ··5204", not the "Blue Cash Everyday ··5201"
 * it started as; its earlier numbers and products stay on their statements, as its history. The
 * name only follows the product while it's one the app gave it (an earlier product, or the
 * "Bank Card"-style default): a name the person typed is theirs and stays.
 */
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';

const same = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * Pure. account: { name, mask, issuer, account_type }; statements: [{ period_end, card_mask, product_name }].
 * Returns the fields to change ({ mask?, name? }), or {}.
 */
export function currentCard(account, statements) {
  const dated = statements.filter((s) => s.period_end).sort((a, b) => String(b.period_end).localeCompare(String(a.period_end)));
  const changes = {};
  const mask = dated.find((s) => s.card_mask)?.card_mask;
  if (mask && mask !== account.mask) changes.mask = mask;
  const product = dated.find((s) => s.product_name)?.product_name;
  const given = statements.some((s) => same(s.product_name, account.name))
    || same(account.name, [account.issuer, account.account_type === 'CREDIT_CARD' ? 'Card' : null].filter(Boolean).join(' '));
  if (product && given && !same(product, account.name)) changes.name = product;
  return changes;
}

/** Applies currentCard to an account after a statement is approved. Audited; returns the changes. */
export async function learnCurrentCard(accountId) {
  const { rows: [account] } = await query('SELECT id, name, mask, issuer, account_type FROM account WHERE id = $1', [accountId]);
  if (!account) return {};
  const { rows: statements } = await query(
    `SELECT to_char(period_end, 'YYYY-MM-DD') AS period_end, card_mask, product_name FROM statement WHERE account_id = $1`, [accountId]);
  const changes = currentCard(account, statements);
  if (Object.keys(changes).length === 0) return {};
  await query('UPDATE account SET name = COALESCE($2, name), mask = COALESCE($3, mask) WHERE id = $1', [accountId, changes.name ?? null, changes.mask ?? null]);
  await audit({ action: 'account.current_card', entityType: 'account', entityId: accountId, detail: { from: { name: account.name, mask: account.mask }, to: changes } });
  return changes;
}
