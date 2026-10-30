/**
 * The six boxes Import shows while a statement is read (D325): Upload,
 * Open, Find the card, Read transactions, Name & sort, Check totals.
 *
 * The parse is one request, so the page can't watch it happen. Instead
 * the response says what each box found (readingFacts), and a failure
 * says which box it stopped at (stage), so the page replays the real
 * result rather than a timer pretending to know.
 *
 * Pure: facts in, answer out. Nothing here is stored.
 */

export const STAGES = ['upload', 'open', 'find', 'read', 'sort', 'check'];

// pdfjs-dist's own errors for a file it can't open at all: damaged,
// truncated, or not really a PDF inside.
const CANT_OPEN = new Set(['InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException', 'FormatError']);

/** Which box a thrown parse error belongs to: a password or a damaged file stops at Open, anything else while reading. */
export function stageOfThrow(err) {
  return err?.name === 'PasswordException' || CANT_OPEN.has(err?.name) ? 'open' : 'read';
}

/**
 * What each box shows once a read succeeds.
 *
 * card_known: 'confirmed' (the upload named its account), 'suggested'
 * (matched by last 4 or name; still confirmed by a person, never filed
 * silently), 'tied' (a last 4 more than one account has had), or 'none'.
 */
export function readingFacts({ batch, parsed, suggestedAccountId, maskTied, duplicates = 0, sameStatement = null }) {
  const detected = parsed.account ?? null;
  const rows = parsed.rows ?? [];
  const known = batch.account_id != null ? 'confirmed'
    : suggestedAccountId != null ? 'suggested'
      : maskTied ? 'tied' : 'none';
  return {
    pages: parsed.report?.pages_total ?? null,
    card: detected
      ? { issuer: detected.issuer ?? null, name: detected.name ?? null, mask: detected.mask ?? null, product: detected.product ?? null, holder: detected.holder_name ?? null }
      : null,
    card_known: known,
    account_id: batch.account_id ?? suggestedAccountId ?? null,
    period: parsed.statement?.period_end
      ? { start: parsed.statement.period_start ?? null, end: parsed.statement.period_end }
      : null,
    rows: rows.length,
    sorted: rows.filter((r) => r.suggested_category).length,
    low_confidence: rows.filter((r) => r.confidence === 'LOW').length,
    duplicates,
    same_statement: sameStatement,
  };
}
