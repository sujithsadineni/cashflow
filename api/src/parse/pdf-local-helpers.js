/**
 * Genuinely shared helpers across the local (no-API-call) PDF parsers.
 *
 * Kept deliberately small: pdf-local-amex.js used to note that sharing
 * this wasn't worth it yet for two call sites. Now that Chase and Bilt
 * are being added too — four call sites for the exact same
 * "$1,234.56" -> cents logic — that math has flipped. Everything more
 * issuer-specific (extractMask, extractHolderName, section headers)
 * stays local to each file; those look similar but encode a different
 * label per issuer, so sharing them would be forcing an abstraction
 * over incidental resemblance, not real duplication.
 */

const MONEY_RE = /(-)?\s*\$?\s*((?:\d{1,3}(?:,\d{3})*)?\.\d{2})/;

/** "$1,234.56" / "-1,234.56" / "1234.56" -> integer cents, signed. */
export function parseMoney(str) {
  const m = str.match(MONEY_RE);
  if (!m) return null;
  const cents = Math.round(parseFloat(m[2].replace(/,/g, '')) * 100);
  return m[1] ? -cents : cents;
}

/**
 * A transaction description that spills onto a second physical line —
 * real across every issuer here, not a one-off: an itinerary detail
 * on a BofA travel purchase, an address on a Bilt purchase, a card's
 * last-4 wrapping alone onto its own line on a Chase ATM/debit line
 * ("...TX Card 930.00 1,930.00" / next line just "1789"). None of
 * these have a date, reference, or amount of their own, so they can
 * never be mistaken for a new transaction — only for one that's
 * genuinely unparseable, which is why every caller only merges when
 * `row` (the row just added, in the same still-open section) exists;
 * with no row to attach to, the caller throws instead.
 */
export function mergeContinuation(row, line) {
  row.description = `${row.description} ${line}`;
  row.raw_text = `${row.raw_text} | ${line}`;
}

/**
 * The money amount printed immediately AFTER a given label, same line
 * only — every issuer's "TOTAL X FOR THIS PERIOD" style line prints
 * this way.
 */
export function extractAmountAfterLabel(text, label) {
  const re = new RegExp(`${label}[ \\t]+(-?\\s*\\$?\\s*(?:\\d{1,3}(?:,\\d{3})*)?\\.\\d{2})`, 'i');
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) return parseMoney(m[1]);
  }
  return null;
}

/**
 * Classifying a checking-account line — genuinely shared between BofA
 * (Adv SafeBalance) and Chase (Total Checking): both print the same
 * household's own external cards and ACH transfer codes, so the same
 * "is this really a card payment / self-transfer" rules apply either
 * way, not just a coincidental resemblance.
 *
 * Zelle direction (received vs. sent, or an internal transfer between
 * the household's own names) is deliberately NOT resolved here — see
 * zelle.js/D014. That decision needs to check the description against
 * the contacts table (is this counterparty an actual household
 * member, i.e. an internal self-transfer, or a genuine external third
 * party), which a stateless PDF parser can't do; every parser in this
 * app, local or AI, hands Zelle to that same review step starting
 * from 'transfer', confirmed against this household's real data — the
 * alternative (guessing "from" = deposit, "to" = purchase straight
 * from the text) looks right until an internal transfer between the
 * household's own two names hits it, which real statement history
 * shows really does happen.
 */
const ZELLE_PATTERN = /Zelle/i;

// "Mobile Banking payment to CRD 2468" (BofA's own generic wording)
// and a named card issuer (AMERICAN EXPRESS, BARCLAYCARD, ...) both
// mean the same thing: this household paying down a credit card from
// a checking account. That isn't new spend — the purchase already
// counted when it happened on the card — so these get 'payment'
// (excluded from spend totals, see bilt-rent.js's own docs on the
// same rule) rather than the generic 'purchase' default.
const CARD_PAYMENT_PATTERNS = [
  /Mobile Banking payment to CRD/i,
  /AMERICAN EXPRESS/i, /BARCLAYCARD/i, /APPLECARD/i, /ROBINHOOD MONEY/i,
  /CHASE CREDIT/i, /DISCOVER/i, /CITI ?CARD/i, /SYNCHRONY/i, /CAPITAL ?ONE/i, /ZOLVE/i,
];

// A literal "TRANSFER" in an ACH transaction code ("APPLE GS SAVINGS
// DES:TRANSFER...", "SoFi Bank   DES:TRANSFER...") is the bank's own
// label for a self-to-self movement — the household moving money to
// another account they hold elsewhere, not new income or spend.
// Word-boundary, not a bare substring, for the same reason
// layout-cache.js's issuer guess needed one (a plain `includes` would
// also fire on an unrelated word that happens to contain "transfer").
const TRANSFER_PATTERN = /\bTRANSFER\b/i;

// A loan servicer auto-drafting its payment from checking — real,
// named lenders from this household's own loan table (routes/loans.js),
// not a guess. This is a distinct bucket from CARD_PAYMENT_PATTERNS on
// purpose: category is left null here (not 'Card Payment') so the
// existing historical-category fallback (routes/imports.js, "the
// household's own past transactions already answer... more reliably
// than a fresh guess") fills in 'Loan' from every prior month of the
// exact same description — which it already does correctly. Only
// txn_type needs a push here, since there's no equivalent fallback for
// that column: left at the default 'purchase', a loan payment would
// silently inflate spend by its full amount every month.
const LOAN_PAYMENT_PATTERNS = [/WELLS FARGO/i];

export function classifyCheckingOutflow(description) {
  if (ZELLE_PATTERN.test(description)) return { txn_type: 'transfer', category: null };
  if (TRANSFER_PATTERN.test(description)) return { txn_type: 'transfer', category: null };
  if (LOAN_PAYMENT_PATTERNS.some((p) => p.test(description))) return { txn_type: 'payment', category: null };
  if (CARD_PAYMENT_PATTERNS.some((p) => p.test(description))) return { txn_type: 'payment', category: 'Card Payment' };
  return { txn_type: 'purchase', category: null };
}

export function classifyCheckingInflow(description) {
  if (ZELLE_PATTERN.test(description)) return { txn_type: 'transfer', category: null };
  if (TRANSFER_PATTERN.test(description)) return { txn_type: 'transfer', category: null };
  return { txn_type: 'deposit', category: null };
}
