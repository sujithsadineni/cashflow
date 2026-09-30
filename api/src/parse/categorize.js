/**
 * Enrichment for CSV rows: transaction type, cleaned merchant name,
 * and a suggested category — one batched call on a small fast model,
 * costing about a cent per statement.
 *
 * Deliberately non-fatal: if the call fails (no key, rate limit,
 * whatever), the import proceeds with plain rows and the human
 * categorizes by hand, exactly as before. Enrichment is a
 * convenience, never a dependency.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { logger } from '../logger.js';
import { TXN_TYPES } from './pdf.js';

const EnrichmentSchema = z.object({
  rows: z.array(
    z.object({
      index: z.number().int(),
      merchant: z.string().nullable(),
      txn_type: z.enum(TXN_TYPES),
      category: z.string().nullable(),
    })
  ),
});

const buildPrompt = (categoryNames) => `You classify bank/credit-card transactions. For each row, return:
- merchant: the human name behind the raw description — "AMZN MKTP US*2K4X" is "Amazon". Strip store numbers, processor prefixes, reference codes. null when there is no meaningful merchant (payments, transfers, interest).
- txn_type: purchase, refund, payment (credit card bill payment, either side), transfer (between the person's own accounts, incl. Zelle to individuals and savings sweeps), deposit (income: payroll, tax refunds), fee, interest, or cashback.
  A "[MERCHANT] CHARGE ADJUSTMENT" line that reverses another charge for the same merchant (common on rent-payment cards like Bilt, where the real payment is drawn from a linked bank account, not the card) is a transfer, not a refund.
- category: the best fit FROM THIS LIST, verbatim, or null: ${categoryNames.join(', ')}. Never invent one. Payments and transfers usually take null.
Amounts are integer cents; negative is money out. Return one entry per input row, keyed by its index.`;

/**
 * rows: [{ description, amount_cents }] — enriched by array index.
 * Returns a Map(index → {merchant, txn_type, suggested_category}),
 * or null when enrichment wasn't possible.
 */
export async function enrichRows(rows, categoryNames) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: 'claude-haiku-4-5',
      max_tokens: 16000,
      system: buildPrompt(categoryNames),
      messages: [
        {
          role: 'user',
          content: JSON.stringify(
            rows.map((r, index) => ({
              index,
              description: r.description,
              amount_cents: r.amount_cents,
            }))
          ),
        },
      ],
      output_config: { format: zodOutputFormat(EnrichmentSchema) },
    });

    if (!response.parsed_output) return null;

    const canonical = new Map(categoryNames.map((n) => [n.toLowerCase(), n]));
    const byIndex = new Map();
    for (const row of response.parsed_output.rows) {
      byIndex.set(row.index, {
        merchant: row.merchant,
        txn_type: row.txn_type,
        suggested_category: row.category
          ? (canonical.get(row.category.toLowerCase()) ?? null)
          : null,
      });
    }
    return byIndex;
  } catch (err) {
    logger.warn({ err: err.message }, 'row enrichment skipped');
    return null;
  }
}
