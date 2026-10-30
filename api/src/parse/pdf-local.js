/**
 * Local PDF extraction — no Anthropic API call, no cost, and (per the
 * household's own request) something to actually verify: every row
 * comes with a reconciliation check against the statement's own
 * printed totals, not just a confident-looking guess.
 *
 * Reuses stages 1-3 of the AI pipeline (pdf-pages.js, classify.js,
 * layout-cache.js are already fully local and free) and replaces only
 * stage 4 — the actual extraction — with a per-issuer deterministic
 * parser. Only issuers with a real parser built and verified against
 * this household's own statement history are supported; anything else
 * returns a clear, actionable error rather than a wrong guess — same
 * rule as the CSV parser (D12): never silently drop or invent data.
 *
 * Output shape matches extractStatementFromPdf exactly, so it drops
 * into the same downstream pipeline (staged_transaction, review,
 * approve, the Bilt-rent override) with no changes needed there.
 */

import { extractPdfPages } from './pdf-pages.js';
import { readCardFacts } from '../statements/facts/card-facts.js';
import { readSavings } from '../statements/facts/savings.js';
import { classifyPages } from './classify.js';
import { guessIssuerFromPageOne } from './layout-cache.js';
import { redactPan } from './redact.js';
import { extractBofaLocally } from './readers/pdf-local-bofa.js';
import { extractAmexLocally } from './readers/pdf-local-amex.js';
import { extractChaseLocally } from './readers/pdf-local-chase.js';
import { extractBiltLocally } from './readers/pdf-local-bilt.js';
import { extractRobinhoodLocally } from './readers/pdf-local-robinhood.js';
import { extractRobinhoodSavingsLocally, isRobinhoodSavings } from './readers/pdf-local-robinhood-savings.js';
import { extractBarclaysLocally } from './readers/pdf-local-barclays.js';
import { extractSofiLocally } from './readers/pdf-local-sofi.js';
import { extractAppleLocally } from './readers/pdf-local-apple.js';
import { extractZolveLocally } from './readers/pdf-local-zolve.js';
import { cleanMerchantName } from './local-merchants.js';
import { extractPromos } from './promos.js';
import { extractStatementDates } from './statement-dates.js';

const ISSUER_PARSERS = [
  { guess: 'bank of america', parse: extractBofaLocally },
  { guess: 'american express', parse: extractAmexLocally },
  { guess: 'amex', parse: extractAmexLocally },
  { guess: 'chase', parse: extractChaseLocally },
  { guess: 'bilt', parse: extractBiltLocally },
  // Robinhood has two layouts: the Gold Card and Robinhood Banking savings.
  {
    guess: 'robinhood',
    parse: (pages, ...rest) => (isRobinhoodSavings(pages[0]?.text ?? '') ? extractRobinhoodSavingsLocally : extractRobinhoodLocally)(pages, ...rest),
  },
  { guess: 'barclays', parse: extractBarclaysLocally },
  { guess: 'sofi', parse: extractSofiLocally },
  { guess: 'apple card', parse: extractAppleLocally },
  { guess: 'zolve', parse: extractZolveLocally },
];

/**
 * @param buffer - the raw PDF file
 * @param categoryNames - unused here (rows carry a category name
 *   directly, resolved to an id by the caller same as the AI path) —
 *   kept as a parameter so call sites don't need to branch on which
 *   parser they're using.
 * @param password - optional, for a household-encrypted PDF
 * Returns { ok, account, statement, rows, report } or { ok: false, error }.
 */
export async function extractStatementFromPdfLocally(buffer, categoryNames, password) {
  const pages = await extractPdfPages(buffer, password);
  const classifications = classifyPages(pages);

  const pageOneText = pages[0]?.text ?? '';
  const issuerGuess = guessIssuerFromPageOne(pageOneText);
  const parser = ISSUER_PARSERS.find((p) => p.guess === issuerGuess);

  if (!parser) {
    return {
      ok: false,
      stage: 'find', // Import's Find the card box (D325): the bank isn't one it reads
      error: issuerGuess
        ? `The free reader doesn't know ${issuerGuess} statements yet.`
        : `It isn't from a bank the free reader knows (Bank of America, American Express, Chase, Bilt, Robinhood, Barclays, SoFi, Apple Card, Zolve).`,
    };
  }

  let result;
  try {
    result = parser.parse(pages, classifications, cleanMerchantName);
  } catch (err) {
    return { ok: false, error: `Local parsing failed: ${err.message}` };
  }

  const report = {
    parse_method: 'local',
    pages_total: pages.length,
    estimated_cost_usd: 0,
    reconciliation: result.reconciliation,
  };

  // A card's due date and minimum payment, read the same way for every issuer (D270).
  // And its credit line and year-to-date box (D346).
  // A bank account: what its money earned, as printed (D355).
  const dates = result.account?.account_type === 'CREDIT_CARD'
    ? { ...extractStatementDates(pages, { periodEnd: result.statement?.period_end, owedCents: result.statement?.closing_balance_cents }), ...readCardFacts(pages) }
    : { savings: readSavings(pages.map((p) => p.text ?? '').join('\n')) };

  return {
    ok: true,
    account: result.account,
    statement: { ...result.statement, ...dates, promos: extractPromos(pages) },
    rows: result.rows.map((r) => stagedRowFrom(r, categoryNames)),
    report,
  };
}

/**
 * A reader's row as Import stages it. Who spent it on a shared card (the
 * section it printed under, and that card's ending: D344) is kept, or a
 * co-owner's and a member's rows all land on the owner and nobody is proposed.
 */
export function stagedRowFrom(r, categoryNames) {
  return {
    posted_date: r.posted_date,
    description: redactPan(r.description),
    merchant: redactPan(r.merchant),
    amount_cents: r.amount_cents,
    txn_type: r.txn_type,
    suggested_category: categoryNames.includes(r.suggested_category) ? r.suggested_category : null,
    confidence: r.confidence,
    raw_text: r.raw_text,
    spender_name: r.spender_name ?? null,
    card_ending: r.card_ending ?? null,
  };
}

/** Which issuers local parsing currently supports — for the frontend to show upfront, before a file is even chosen. */
export const LOCAL_PARSER_ISSUERS = ['Bank of America', 'American Express', 'Chase', 'Bilt', 'Robinhood', 'Barclays', 'SoFi', 'Apple Card', 'Zolve'];
