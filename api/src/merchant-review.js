/**
 * Finds transactions whose merchant is missing or looks like a
 * variant of an existing one — "COSTCO WHSE #0187 770-622-1330 GA"
 * when "Costco" is already a real merchant elsewhere, "AMAZON" when
 * "Amazon" is the household's usual casing. A high-confidence match
 * is applied directly; anything less certain lands in `merchant_review`
 * for a person to confirm instead of guessing.
 *
 * Deliberately no AI call here — this is plain string matching against
 * merchant names the household's own data already established, not a
 * new paid classification pass. That's a real design choice: it's
 * exactly the kind of "silently wrong financial data" this app's own
 * rules (see CLAUDE.md) treat as worse than asking.
 *
 * Called two ways:
 *   - `flagOrFixMerchants(transactionIds, client)` — the live hook,
 *     mirrors `matchNewTransactions` in routes/recurring.js: called
 *     right after an import's rows land in `transaction`, inside the
 *     same DB transaction, so newly-approved statements get scanned
 *     automatically going forward.
 *   - `rescanAllTransactions(client)` — the one-time backfill over
 *     everything already in the database.
 * Both share the same decision logic (`matchMerchant`), so "scan on
 * import" and "scan everything" can never drift apart.
 */

import { audit } from './audit.js';

const normalize = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokenize = (s) => {
  const n = normalize(s);
  return n ? n.split(' ') : [];
};

/** Does `haystack` contain `needle` as a contiguous run of tokens? */
function containsSubsequence(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Builds the canonical merchant set from the household's own data:
 * one entry per distinct normalized name, holding whichever raw
 * casing is most common (ties broken alphabetically, deterministic).
 */
export async function buildCanonicalMerchants(client) {
  const { rows } = await client.query(
    `SELECT merchant, COUNT(*) AS count
       FROM transaction
      WHERE merchant IS NOT NULL
      GROUP BY merchant`
  );

  const byNorm = new Map(); // normalized -> { name, count, tokens }
  for (const row of rows) {
    const norm = normalize(row.merchant);
    if (!norm) continue;
    const count = Number(row.count);
    const existing = byNorm.get(norm);
    if (!existing || count > existing.count || (count === existing.count && row.merchant < existing.name)) {
      byNorm.set(norm, { name: row.merchant, count, tokens: norm.split(' ') });
    }
  }
  return byNorm;
}

/**
 * Pure decision function — no DB access, easy to reason about and
 * (if it's ever wrong) fix in one place. Returns:
 *   { action: 'none' }
 *   { action: 'fix', merchant, reason }
 *   { action: 'flag', merchant, reason }
 */
export function matchMerchant(transaction, canonicalMerchants) {
  const { merchant, description } = transaction;

  if (!merchant) {
    const descTokens = tokenize(description);
    const matches = [];
    for (const entry of canonicalMerchants.values()) {
      // A short merchant name risks colliding with an ordinary English
      // word rather than actually identifying the brand — real bug
      // caught in a dry run: "On" (a real shoe brand) matched every
      // "INTEREST CHARGED ON PURCHASES" row in the household's data.
      // Same length floor as the duplicate-cluster check below, for
      // the same reason.
      if (entry.tokens.join('').length < 4) continue;
      if (containsSubsequence(descTokens, entry.tokens)) matches.push(entry);
    }
    if (matches.length === 1) {
      return { action: 'fix', merchant: matches[0].name, reason: `Description contains the existing merchant "${matches[0].name}"` };
    }
    if (matches.length > 1) {
      matches.sort((a, b) => b.count - a.count);
      const names = matches.map((m) => m.name).join('", "');
      return { action: 'flag', merchant: matches[0].name, reason: `Description matches more than one existing merchant: "${names}"` };
    }
    return { action: 'none' };
  }

  // Merchant is already set — look for a same-spelling-different-case
  // match, or a substring relationship with a more established name.
  const norm = normalize(merchant);
  const self = canonicalMerchants.get(norm);
  if (self && self.name !== merchant && self.count >= (transaction.ownCount ?? 0)) {
    // A more (or equally) common variant already exists under a
    // different casing/punctuation — same normalized form, so this
    // is a formatting difference, not a different merchant.
    return { action: 'fix', merchant: self.name, reason: `Same merchant as the more common "${self.name}" (different formatting)` };
  }

  for (const entry of canonicalMerchants.values()) {
    if (entry.name === merchant) continue;
    const a = norm, b = normalize(entry.name);
    if (a.length < 4 || b.length < 4) continue; // too short to trust a substring match
    if (a !== b && (a.includes(b) || b.includes(a)) && entry.count > (transaction.ownCount ?? 0)) {
      return { action: 'flag', merchant: entry.name, reason: `Similar to the existing merchant "${entry.name}"` };
    }
  }

  return { action: 'none' };
}

async function applyFix(client, transactionId, oldMerchant, newMerchant) {
  await client.query('UPDATE transaction SET merchant = $1, updated_at = now() WHERE id = $2', [newMerchant, transactionId]);
  // Carry any icon customization on the old casing over to the
  // canonical one, so a rename never silently drops a chosen emoji
  // or photo. Only when the canonical name has no customization of
  // its own yet — that one always wins if it exists.
  if (oldMerchant) {
    await client.query(
      `UPDATE merchant_icon SET merchant = $1
        WHERE merchant = $2
          AND NOT EXISTS (SELECT 1 FROM merchant_icon WHERE merchant = $1)`,
      [newMerchant, oldMerchant]
    );
  }
  await audit({
    action: 'transaction.merchant_auto_fixed',
    entityType: 'transaction',
    entityId: transactionId,
    detail: { from: oldMerchant, to: newMerchant },
  });
}

async function applyFlag(client, transactionId, currentMerchant, suggestedMerchant, reason) {
  await client.query(
    `INSERT INTO merchant_review (transaction_id, current_merchant, suggested_merchant, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (transaction_id) DO NOTHING`,
    [transactionId, currentMerchant, suggestedMerchant, reason]
  );
}

/** The live hook — called right after an import's rows are approved. */
export async function flagOrFixMerchants(transactionIds, client) {
  if (transactionIds.length === 0) return;

  const canonical = await buildCanonicalMerchants(client);
  const { rows: transactions } = await client.query(
    `SELECT id, merchant, description FROM transaction WHERE id = ANY($1)`,
    [transactionIds]
  );

  for (const t of transactions) {
    const ownCount = t.merchant ? (canonical.get(normalize(t.merchant))?.count ?? 1) : 0;
    const decision = matchMerchant({ ...t, ownCount }, canonical);
    if (decision.action === 'fix') {
      await applyFix(client, t.id, t.merchant, decision.merchant);
      // A fix changes the canonical picture for subsequent rows in
      // this same batch — cheap to recompute since batches are small.
      canonical.set(normalize(decision.merchant), {
        name: decision.merchant,
        count: (canonical.get(normalize(decision.merchant))?.count ?? 0) + 1,
        tokens: normalize(decision.merchant).split(' '),
      });
    } else if (decision.action === 'flag') {
      await applyFlag(client, t.id, t.merchant, decision.merchant, decision.reason);
    }
  }
}

/** The one-time backfill over every transaction already in the database. */
export async function rescanAllTransactions(client) {
  const canonical = await buildCanonicalMerchants(client);
  const { rows: transactions } = await client.query(`SELECT id, merchant, description FROM transaction`);

  const result = { fixed: 0, flagged: 0 };
  for (const t of transactions) {
    const ownCount = t.merchant ? (canonical.get(normalize(t.merchant))?.count ?? 1) : 0;
    const decision = matchMerchant({ ...t, ownCount }, canonical);
    if (decision.action === 'fix') {
      await applyFix(client, t.id, t.merchant, decision.merchant);
      result.fixed++;
    } else if (decision.action === 'flag') {
      await applyFlag(client, t.id, t.merchant, decision.merchant, decision.reason);
      result.flagged++;
    }
  }
  return result;
}
