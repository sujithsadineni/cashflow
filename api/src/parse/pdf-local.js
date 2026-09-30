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
import { classifyPages } from './classify.js';
import { guessIssuerFromPageOne } from './layout-cache.js';
import { redactPan } from './redact.js';
import { extractBofaLocally } from './pdf-local-bofa.js';
import { extractAmexLocally } from './pdf-local-amex.js';
import { extractChaseLocally } from './pdf-local-chase.js';
import { extractBiltLocally } from './pdf-local-bilt.js';
import { cleanMerchantName } from './local-merchants.js';

const ISSUER_PARSERS = [
  { guess: 'bank of america', parse: extractBofaLocally },
  { guess: 'american express', parse: extractAmexLocally },
  { guess: 'amex', parse: extractAmexLocally },
  { guess: 'chase', parse: extractChaseLocally },
  { guess: 'bilt', parse: extractBiltLocally },
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
      error: issuerGuess
        ? `Local parsing isn't built for ${issuerGuess} yet — use "Parse with Claude" instead.`
        : `Couldn't identify the issuer from page 1 — local parsing only knows Bank of America and American Express so far. Use "Parse with Claude" instead.`,
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

  return {
    ok: true,
    account: result.account,
    statement: result.statement,
    rows: result.rows.map((r) => ({
      posted_date: r.posted_date,
      description: redactPan(r.description),
      merchant: redactPan(r.merchant),
      amount_cents: r.amount_cents,
      txn_type: r.txn_type,
      suggested_category: categoryNames.includes(r.suggested_category) ? r.suggested_category : null,
      confidence: r.confidence,
      raw_text: r.raw_text,
    })),
    report,
  };
}

/** Which issuers local parsing currently supports — for the frontend to show upfront, before a file is even chosen. */
export const LOCAL_PARSER_ISSUERS = ['Bank of America', 'American Express', 'Chase', 'Bilt'];
