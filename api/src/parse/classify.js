/**
 * Stage 2 — local page classification. Free, deterministic, no model
 * call. Every page is scored on the same signals and run through an
 * explicit, ordered decision list — checked top to bottom, first
 * match wins — rather than a weighted black-box score, so the logic
 * can be read and tuned by inspection.
 *
 * The thresholds here were set against real per-page text pulled from
 * this project's own approved statements (two issuers, 33 pages), not
 * guessed. See docs/DECISIONS.md for the validation table. The two
 * traps that shaped the rules:
 *
 *   - An interest-rate table is packed with repeated "$0.00", which
 *     gives it a HIGH currency-ratio despite having no transactions.
 *     Currency-ratio alone is not trustworthy; date-ratio and
 *     boilerplate phrases have to agree with it.
 *   - A page with only 2 real transactions surrounded by "Total"
 *     lines and a scam-tip blurb has a much LOWER date-ratio than a
 *     dense credit-card grid. The transaction-table header phrase
 *     ("Date  Description  Amount") is what saves it — ratio
 *     thresholds alone would misclassify a real, sparse page.
 */

const DATE_RE =
  /\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])([/-]\d{2,4})?\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/g;

const CURRENCY_RE = /(?:\$|\s|^)-?\s?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\b/g;

const BOILERPLATE_PHRASES = [
  'terms and conditions',
  'annual percentage rate',
  'how to avoid paying interest',
  'billing rights',
  'grace period',
  'daily periodic rate',
  'interest charge computation',
  'how we allocate your payments',
  'credit reporting disclosure',
  'important disclosures',
  'in case of errors or questions',
];

const SUMMARY_PHRASES = [
  'account summary',
  'new balance',
  'previous balance',
  'beginning balance',
  'ending balance',
  'minimum payment due',
  'payment due date',
  'credit limit',
  'available credit',
];

// Matched against whitespace-collapsed text — pdf.js sometimes emits
// irregular multi-space gaps between table columns (preserving visual
// spacing from the source PDF), so 'Date   Description   Amount' and
// 'Date Description Amount' both need to match the same phrase.
const TXN_HEADER_PHRASES = ['date description amount', 'transactions', 'posting date'];

const CASHBACK_PHRASES = ['cash back earned', 'reward summary', 'rewards earned', 'cashback earned'];

const countMatches = (text, re) => (text.match(re) || []).length;
const countPhraseHits = (lowerText, phrases) => phrases.filter((p) => lowerText.includes(p)).length;

/**
 * Cross-page running headers/footers (name, account number, statement
 * period repeated on every page) inflate the date/currency count on
 * otherwise-empty pages — a page reading only "This page intentionally
 * left blank" plus a header carrying two dates in the statement period
 * would otherwise score as dense as a real transaction grid.
 *
 * A line that appears, near-verbatim, on most pages of the document is
 * almost certainly a running header rather than content — normalize
 * out digits (which vary: account numbers, dates) and compare.
 */
export function findRepeatingLines(pages) {
  const normalize = (line) => line.toLowerCase().replace(/\d/g, '#').trim();

  const counts = new Map();
  for (const page of pages) {
    const seenOnThisPage = new Set(page.lines.map(normalize));
    for (const key of seenOnThisPage) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  const repeating = new Set();
  for (const [key, count] of counts) {
    if (count >= threshold) repeating.add(key);
  }
  return repeating;
}

/** Score one page's signals. Exposed separately from classify() so the report can show the numbers. */
export function scorePage(lines, repeatingLines = new Set()) {
  const normalize = (line) => line.toLowerCase().replace(/\d/g, '#').trim();
  const contentLines = repeatingLines.size > 0
    ? lines.filter((l) => !repeatingLines.has(normalize(l)))
    : lines;

  const text = contentLines.join('\n');
  const lower = text.toLowerCase();
  const lowerCollapsed = lower.replace(/\s+/g, ' ');
  const lineCount = contentLines.length || 1;

  const dateCount = countMatches(text, DATE_RE);
  const currencyCount = countMatches(text, CURRENCY_RE);

  return {
    lineCount,
    dateCount,
    currencyCount,
    dateRatio: dateCount / lineCount,
    currencyRatio: currencyCount / lineCount,
    avgLineLength: contentLines.reduce((s, l) => s + l.length, 0) / lineCount,
    boilerplateHits: countPhraseHits(lowerCollapsed, BOILERPLATE_PHRASES),
    summaryHits: countPhraseHits(lowerCollapsed, SUMMARY_PHRASES),
    txnHeaderHits: countPhraseHits(lowerCollapsed, TXN_HEADER_PHRASES),
    cashbackHits: countPhraseHits(lowerCollapsed, CASHBACK_PHRASES),
  };
}

/**
 * Classify one page from its already-computed score. Returns
 * { role, reason } — reason names which rule fired, for the stage 5
 * report and for tuning.
 */
export function classifyFromScore(score) {
  if (score.cashbackHits > 0) {
    return { role: 'SUMMARY', reason: 'cashback figure present' };
  }
  if (score.boilerplateHits >= 2 && score.dateRatio < 0.15 && score.currencyRatio < 0.15) {
    return { role: 'BOILERPLATE', reason: 'multiple boilerplate phrases, low financial density' };
  }
  if (score.avgLineLength > 80 && score.dateRatio < 0.1) {
    return { role: 'BOILERPLATE', reason: 'long prose lines, almost no dates' };
  }
  if (score.dateRatio >= 0.3 || score.txnHeaderHits >= 1) {
    return { role: 'TRANSACTIONS', reason: score.txnHeaderHits >= 1 ? 'transaction header phrase' : 'high date density' };
  }
  if (score.summaryHits > 0 || score.dateRatio >= 0.1) {
    return { role: 'SUMMARY', reason: score.summaryHits > 0 ? 'summary phrase' : 'moderate date density' };
  }
  if (score.boilerplateHits >= 1) {
    return { role: 'BOILERPLATE', reason: 'boilerplate phrase, otherwise sparse' };
  }
  // Never drop on ambiguity — an unclassifiable page still gets sent.
  return { role: 'SUMMARY', reason: 'ambiguous — included conservatively' };
}

/**
 * Classify every page of a document. Computes the repeating-header
 * set once, across all pages, before scoring any individual page.
 */
export function classifyPages(pages) {
  const repeatingLines = findRepeatingLines(pages);

  return pages.map((page) => {
    if (!page.hasTextLayer) {
      return {
        pageNumber: page.pageNumber,
        role: 'NEEDS_IMAGE',
        reason: 'no usable text layer — likely a scan',
        score: null,
      };
    }
    const score = scorePage(page.lines, repeatingLines);
    const { role, reason } = classifyFromScore(score);
    return { pageNumber: page.pageNumber, role, reason, score };
  });
}
