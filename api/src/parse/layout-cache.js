/**
 * Stage 3 — issuer layout fingerprint.
 *
 * Stage 2 classification is free and instant (regex over text already
 * extracted locally), so there's nothing cheaper to fall back to —
 * this table doesn't skip running it. What it actually buys:
 *
 *   1. Drift detection: does this statement's page-role pattern match
 *      what we saw last time from this issuer? A mismatch (issuer
 *      redesigned their statement, or transaction volume pushed
 *      content onto a different page) is worth surfacing, never
 *      silently trusted.
 *   2. Column hints for the extraction prompt: the transaction-table
 *      header phrase this issuer uses, learned once and passed to
 *      Claude next time to improve column mapping.
 *   3. Reporting: "known issuer, layout matched" vs "new template".
 */

import { query } from '../db.js';

/** Slug used as the cache key — the account's issuer plus its type. */
export function issuerKey(issuer, accountType) {
  const slug = (issuer ?? 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `${slug}/${(accountType ?? 'unknown').toLowerCase()}`;
}

/**
 * A cheap LOCAL guess at the issuer, from page-1 text alone — used
 * only to look up a cached layout (for column hints) before the
 * extraction call happens. Claude's own extracted `account.issuer` is
 * the source of truth and is what the cache actually gets written
 * back under; if this guess is wrong or misses, the worst case is a
 * cache miss on this one call, not a wrong classification.
 */
// Order matters for a statement that could plausibly match two of
// these (Bilt's own statement also says "Cardless Inc." — its
// servicer, not its brand) — the more specific/customer-facing name
// goes first so .find() lands on it.
const KNOWN_ISSUERS = [
  'bank of america', 'bilt', 'chase', 'jpmorgan', 'wells fargo', 'citibank', 'citi',
  'capital one', 'discover', 'american express', 'amex', 'us bank',
  'pnc', 'truist', 'cardless',
];

/**
 * Plain substring matching used to say every Bilt and Robinhood
 * statement was issued by "Chase" — "chase" is a literal substring of
 * "purchase"/"purchases", which appears on nearly every card
 * statement regardless of issuer. Word-boundary matching is enough to
 * fix it: "chase" preceded immediately by the word-character "r" (as
 * in "pur|chase") has no boundary there, so \b correctly excludes it,
 * while a real "Chase Bank" or "JPMorgan Chase" reference still has
 * word boundaries on both sides.
 */
export function guessIssuerFromPageOne(pageOneText) {
  const lower = (pageOneText ?? '').toLowerCase();
  return KNOWN_ISSUERS.find((name) => new RegExp(`\\b${name}\\b`).test(lower)) ?? null;
}

/** Fetch a cached layout by issuer/type guess, for prompt hints. Returns null on a miss. */
export async function lookupLayoutHint(issuerGuess, accountTypeGuess) {
  if (!issuerGuess) return null;
  const key = issuerKey(issuerGuess, accountTypeGuess);
  const { rows } = await query('SELECT * FROM statement_layout WHERE issuer_key = $1', [key]);
  return rows[0] ?? null;
}

/**
 * Compare this statement's classification against the cached layout
 * (if any), update the cache, and return what the caller needs to
 * know: whether it matched, and any column hint to feed the prompt.
 */
export async function checkAndUpdateLayout(issuer, accountType, pageResults) {
  const key = issuerKey(issuer, accountType);
  const pageRoles = pageResults.map((p) => p.role);
  const sawHeaderPhrase = pageResults.some((p) => p.score?.txnHeaderHits > 0);
  const headerSignature = sawHeaderPhrase ? 'header phrase present' : null;

  const { rows } = await query('SELECT * FROM statement_layout WHERE issuer_key = $1', [key]);
  const existing = rows[0] ?? null;

  let status;
  if (!existing) {
    status = 'new';
  } else if (
    existing.page_count === pageResults.length &&
    JSON.stringify(existing.page_roles) === JSON.stringify(pageRoles)
  ) {
    status = 'matched';
  } else {
    status = 'changed';
  }

  if (!existing) {
    await query(
      `INSERT INTO statement_layout (issuer_key, page_count, page_roles, header_signature)
       VALUES ($1, $2, $3, $4)`,
      [key, pageResults.length, pageRoles, headerSignature]
    );
  } else {
    await query(
      `UPDATE statement_layout
          SET page_count = $2, page_roles = $3, header_signature = COALESCE($4, header_signature),
              times_seen = times_seen + 1, last_seen_at = now()
        WHERE issuer_key = $1`,
      [key, pageResults.length, pageRoles, headerSignature]
    );
  }

  return { issuerKey: key, status, timesSeenBefore: existing?.times_seen ?? 0 };
}
