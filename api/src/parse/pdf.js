/**
 * PDF statement parsing — the full local-first pipeline.
 *
 * Statements are mostly boilerplate: terms and conditions, APR
 * tables, fee schedules. Sending those to the model costs tokens and
 * hurts accuracy — a terms page is full of percentages and dollar
 * figures an extractor can mistake for transactions. So:
 *
 *   Stage 1 (pdf-pages.js)    — local text extraction, free
 *   Stage 2 (classify.js)     — local page classification, free
 *   Stage 3 (layout-cache.js) — issuer fingerprint: drift detection
 *                                and column hints, not a shortcut
 *                                around stage 2 (which is already free)
 *   Stage 4 (this file)       — send only TRANSACTIONS/SUMMARY pages,
 *                                as text where possible, structured
 *                                output, strict schema
 *   Stage 5 (this file)       — a report: what was sent, what was
 *                                skipped and why, estimated cost
 *
 * Same output shape as before: { ok, account, statement, rows }, now
 * with a `report` alongside. staged_transaction, review and duplicate
 * detection downstream are unaffected.
 */

import Anthropic from '@anthropic-ai/sdk';
// zod/v4, not plain zod: the SDK's zodOutputFormat helper converts the
// schema with zod v4's toJSONSchema, and a classic-v3 schema object
// crashes it. The rest of the app stays on the classic import.
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { logger } from '../logger.js';
import { extractPdfPages } from './pdf-pages.js';
import { classifyPages } from './classify.js';
import { renderPageToPng } from './render-page.js';
import { redactPan } from './redact.js';
import { guessIssuerFromPageOne, lookupLayoutHint, checkAndUpdateLayout } from './layout-cache.js';

export const TXN_TYPES = [
  'purchase', 'refund', 'payment', 'transfer', 'deposit', 'fee', 'interest', 'cashback',
];

const StatementSchema = z.object({
  account: z.object({
    name: z.string().nullable(),
    issuer: z.string().nullable(),
    mask: z.string().regex(/^\d{4}$/).nullable(), // LAST 4 DIGITS ONLY
    account_type: z.enum(['CREDIT_CARD', 'CHECKING', 'SAVINGS']).nullable(),
    holder_name: z.string().nullable(),
  }),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  opening_balance_cents: z.number().int().nullable(),
  closing_balance_cents: z.number().int().nullable(),
  total_spend_cents: z.number().int().nullable(),
  total_payments_cents: z.number().int().nullable(),
  // Read off the statement, never calculated. null when the statement
  // simply doesn't print one (checking accounts don't).
  cashback_earned_cents: z.number().int().nullable(),
  cashback_balance_cents: z.number().int().nullable(),
  transactions: z.array(
    z.object({
      posted_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      description: z.string(),
      merchant: z.string().nullable(),
      amount_cents: z.number().int(),
      txn_type: z.enum(TXN_TYPES),
      category: z.string().nullable(),
      confidence: z.enum(['HIGH', 'LOW']),
    })
  ),
});

const buildSystemPrompt = (categoryNames, columnHint) => `You extract transactions from bank and credit card statements. You are given only the pages that carry balances or transactions — boilerplate (terms, APR tables, legal notices) has already been filtered out locally, so treat every page you see as relevant. Some pages arrive as text, some as images of a page that had no text layer (a scan) — read both the same way.

Precision rules:
- All money values are INTEGER CENTS: $12.34 is 1234. Never decimals.
- Sign convention: money leaving the account is NEGATIVE, money arriving is POSITIVE.
  On a checking account: purchases, withdrawals and transfers out are negative; deposits and refunds are positive.
  On a credit card: purchases, fees and interest are negative; payments received, refunds and statement credits are positive — even if the statement prints purchases as positive numbers, you must normalize to this convention.
  A balance transfer, cash advance, or "Direct Deposit"/"Check" cash-advance draw is POSITIVE too, not negative — it increases what's owed on the card, but real cash is arriving for the cardholder (or debt is moving onto this card), the opposite of a purchase. Sign by what happens to the PERSON's money, never by whether the card's own balance went up or down — a purchase and a cash-advance draw both increase the balance owed, but only one of them is money the person actually spent.
- Dates are YYYY-MM-DD. Statements often print MM/DD only — take the year from the statement period, and be careful when a period spans a year boundary (a December date belongs to the earlier year).
- Extract every transaction line exactly once. Do not invent rows. Do not include running balances, section subtotals, or "Total" lines as transactions.
- Pages are separated by a "--- Page N ---" marker. Some statements repeat a page's content across a text version and, rarely, both a text and image version — do not double-count a transaction that appears more than once because of that.
${columnHint ? `- This issuer's transaction table typically uses these columns: ${columnHint}.\n` : ''}
Account identity — read it off the statement header:
- name: the product name as printed ("Chase Total Checking", "Customized Cash Rewards").
- issuer: the bank ("Chase", "Bank of America").
- mask: the LAST 4 DIGITS of the account number, and only those 4. Never output more of an account or card number, anywhere, in any field.
- account_type: CREDIT_CARD, CHECKING or SAVINGS.
- holder_name: the account holder's name as printed.

Statement summary: period_start, period_end, opening_balance_cents, closing_balance_cents, total_spend_cents, total_payments_cents — all read directly off the statement, never computed by you.

Per-transaction enrichment:
- merchant: the human name behind the raw description — "AMZN MKTP US*2K4X" is "Amazon". Strip store numbers, processor prefixes, reference codes. null when there is no meaningful merchant (payments, transfers, interest).
- txn_type: purchase, refund, payment (paying a credit card bill, from either side), transfer (between the person's own accounts, incl. Zelle to individuals and savings sweeps), deposit (income: payroll, tax refunds), fee, interest, or cashback.
  A line reading "[MERCHANT] CHARGE ADJUSTMENT" (or similar "ADJUSTMENT") that reverses or offsets another charge for the same merchant elsewhere on the statement — common on rent-payment cards (e.g. Bilt), where the card shows a purchase for the rent amount and then an adjustment that cancels it, because the real payment is drawn from a linked bank account, not the card — is a transfer, not a refund: no goods or service was actually returned.
- category: the best fit FROM THIS LIST, verbatim, or null if none fits: ${categoryNames.join(', ')}. Never invent a category. Payments and transfers usually take null.

- cashback_earned_cents is the rewards/cashback figure PRINTED on the statement for this period. Copy it; never compute it from spending, categories, multipliers or caps. If the statement instead breaks it into several printed components with no combined line — e.g. "Base Cash Back Earned", "Category Bonus Earned", "Relationship Bonus Earned" — add those specific printed "earned this period" numbers together; that is arithmetic on numbers the issuer already printed, not modeling their rewards program. Do not use a running or lifetime "Total Available" balance for this field — that is not this period's earnings. Use null only if nothing resembling cashback earned this period is printed at all.
- Set confidence to LOW on any transaction where you are not certain about the date, amount or description. Never guess silently.`;

const CENTS_PER_TOKEN_CHAR_ESTIMATE = 4; // rough chars-per-token for English text
const IMAGE_TOKEN_ESTIMATE = 1600; // a full statement page at our render scale
const OPUS_INPUT_PER_MTOK = 5;
const OPUS_OUTPUT_PER_MTOK = 25;

/**
 * Stage 4 — build the content blocks for exactly the pages worth
 * sending, text where Stage 1 got usable text, image (rendered on
 * demand) where it didn't.
 */
async function buildContentBlocks(buffer, pages, classifications, password) {
  const blocks = [];
  const included = [];
  let textChars = 0;
  let imageCount = 0;

  for (const c of classifications) {
    if (c.role === 'BOILERPLATE') continue;

    if (c.role === 'NEEDS_IMAGE') {
      try {
        const png = await renderPageToPng(buffer, c.pageNumber, password);
        blocks.push({ type: 'text', text: `--- Page ${c.pageNumber} (image, no text layer) ---` });
        blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } });
        included.push({ page: c.pageNumber, role: c.role, sentAs: 'image' });
        imageCount += 1;
      } catch (err) {
        logger.error({ err, page: c.pageNumber }, 'page image render failed');
        included.push({ page: c.pageNumber, role: c.role, sentAs: 'failed', error: err.message });
      }
      continue;
    }

    // TRANSACTIONS or SUMMARY, with a usable text layer.
    const page = pages.find((p) => p.pageNumber === c.pageNumber);
    const marker = `--- Page ${c.pageNumber} (${c.role}) ---`;
    blocks.push({ type: 'text', text: `${marker}\n${page.text}` });
    textChars += marker.length + page.text.length;
    included.push({ page: c.pageNumber, role: c.role, sentAs: 'text' });
  }

  return { blocks, included, textChars, imageCount };
}

/**
 * Extract a statement from a PDF buffer.
 * Returns { ok, account, statement, rows, report } or { ok: false, error }.
 *
 * `password` is optional — only a household-encrypted statement (a
 * Zolve export was the real case) needs it. Threaded straight through
 * to both pdfjs-dist call sites (text extraction and, if a page has
 * no text layer, image rendering); never logged or persisted.
 */
export async function extractStatementFromPdf(buffer, categoryNames, password) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set in api/.env' };
  }

  // Stages 1 & 2: always run, free and instant.
  const pages = await extractPdfPages(buffer, password);
  const classifications = classifyPages(pages);

  const pagesSkipped = classifications
    .filter((c) => c.role === 'BOILERPLATE')
    .map((c) => ({ page: c.pageNumber, role: c.role, reason: c.reason }));

  const { blocks, included, textChars, imageCount } = await buildContentBlocks(buffer, pages, classifications, password);

  if (included.filter((i) => i.sentAs !== 'failed').length === 0) {
    return { ok: false, error: 'Every page was classified as boilerplate — nothing to extract' };
  }

  // Stage 3: a cheap local guess at the issuer, just to look up any
  // cached column hint before the call. The authoritative issuer
  // comes back from extraction itself and is what the cache is
  // actually keyed and written under, below.
  const pageOneText = pages[0]?.text ?? '';
  const issuerGuess = guessIssuerFromPageOne(pageOneText);
  const layoutHint = await lookupLayoutHint(issuerGuess, null);
  const columnHint = layoutHint?.header_signature ?? null;

  const client = new Anthropic();

  let response;
  try {
    response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: buildSystemPrompt(categoryNames, columnHint),
      messages: [
        {
          role: 'user',
          content: [
            ...blocks,
            { type: 'text', text: 'Extract the account identity, statement summary and every transaction from the pages above.' },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(StatementSchema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'Anthropic API key was rejected — check ANTHROPIC_API_KEY' };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `Anthropic API error (${err.status}): ${err.message}` };
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    return { ok: false, error: 'The model declined to process this document' };
  }
  const extracted = response.parsed_output;
  if (!extracted) {
    return { ok: false, error: 'Extraction returned no parseable result — malformed output, nothing was imported' };
  }
  if (extracted.transactions.length === 0) {
    return { ok: false, error: 'No transactions found in the pages sent' };
  }

  // Category names come back model-written; only exact (case-blind)
  // matches against the real list survive.
  const canonical = new Map(categoryNames.map((n) => [n.toLowerCase(), n]));

  // Stage 3, completed: write the fingerprint under the AUTHORITATIVE
  // issuer/type extraction returned, not the pre-call guess.
  let layoutStatus = 'unknown';
  try {
    const result = await checkAndUpdateLayout(extracted.account.issuer, extracted.account.account_type, classifications);
    layoutStatus = result.status;
  } catch (err) {
    logger.warn({ err: err.message }, 'layout fingerprint update skipped');
  }

  // Stage 5: the report. Token/cost figures are estimates, labeled as
  // such — real usage is on response.usage if more precision is ever
  // needed, but the point here is visibility into what got filtered,
  // not a billing-grade number.
  const estimatedInputTokens = Math.ceil(textChars / CENTS_PER_TOKEN_CHAR_ESTIMATE) + imageCount * IMAGE_TOKEN_ESTIMATE;
  const estimatedOutputTokens = 300 + extracted.transactions.length * 40;
  const estimatedCostUsd =
    (estimatedInputTokens / 1_000_000) * OPUS_INPUT_PER_MTOK +
    (estimatedOutputTokens / 1_000_000) * OPUS_OUTPUT_PER_MTOK;

  const report = {
    pages_total: pages.length,
    pages_sent: included,
    pages_skipped: pagesSkipped,
    text_chars_sent: textChars,
    images_sent: imageCount,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(4)),
    layout_status: layoutStatus, // 'new' | 'matched' | 'changed' | 'unknown'
  };

  logger.info({ report }, 'pdf extraction report');

  return {
    ok: true,
    account: {
      name: extracted.account.name,
      issuer: extracted.account.issuer,
      mask: extracted.account.mask,
      account_type: extracted.account.account_type,
      holder_name: extracted.account.holder_name,
    },
    statement: {
      period_start: extracted.period_start,
      period_end: extracted.period_end,
      opening_balance_cents: extracted.opening_balance_cents,
      closing_balance_cents: extracted.closing_balance_cents,
      total_spend_cents: extracted.total_spend_cents,
      total_payments_cents: extracted.total_payments_cents,
      cashback_earned_cents: extracted.cashback_earned_cents,
      cashback_balance_cents: extracted.cashback_balance_cents,
    },
    rows: extracted.transactions.map((t) => ({
      posted_date: t.posted_date,
      description: redactPan(t.description),
      merchant: redactPan(t.merchant),
      amount_cents: t.amount_cents,
      txn_type: t.txn_type,
      suggested_category: t.category ? (canonical.get(t.category.toLowerCase()) ?? null) : null,
      confidence: t.confidence,
      raw_text: null, // no single source line for a PDF row
    })),
    report,
  };
}
