/**
 * Automatic nicknames (D416): every active account with none, or with one the app gave, gets
 * autoNickname() among the others (kept current when a card is upgraded or renamed). One the
 * person set (nickname_auto false) is never touched. Audited once per run, with what changed.
 */
import { query } from '../core/db.js';
import { audit } from '../core/audit.js';
import { autoNickname } from '../../../web/src/lib/accounts/nickname.js';

export async function fillNicknames() {
  const { rows: accounts } = await query(
    'SELECT id, name, issuer, mask, account_type, nickname, nickname_auto FROM account WHERE is_active ORDER BY id');
  const changed = [];
  for (const a of accounts) {
    if (a.nickname && !a.nickname_auto) continue;
    const nickname = autoNickname(a, accounts);
    if (nickname && nickname !== a.nickname) {
      await query('UPDATE account SET nickname = $2, nickname_auto = true WHERE id = $1', [a.id, nickname]);
      changed.push({ id: a.id, from: a.nickname, to: nickname });
    }
  }
  if (changed.length > 0) await audit({ action: 'account.nicknames_filled', entityType: 'account', detail: { changed } });
  return changed;
}
