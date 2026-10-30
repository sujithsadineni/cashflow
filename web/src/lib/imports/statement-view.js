/**
 * What the statement dialog's header and its strip of printed numbers say
 * (D335), worked out without a browser. Amounts stay in cents here; the
 * component formats them (formatMoney is the only divider).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };

/** "Sep 14 – Oct 13, 2026"; "Dec 14, 2025 – Jan 13, 2026" across a new year. */
export function periodLabel(start, end) {
  if (!start || !end) return null;
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  return s.slice(0, 4) === e.slice(0, 4) ? `${day(s)} – ${day(e)}, ${e.slice(0, 4)}` : `${day(s)}, ${s.slice(0, 4)} – ${day(e)}, ${e.slice(0, 4)}`;
}

/**
 * The header: the card's name and last four, and under it the dates and how
 * far along it is. The filing name (bofa-5109-2026-10) was the title before;
 * it's built for the list, and said nothing about the dates. Null until the
 * statement's card and dates are known, when the file's own name stays.
 */
export function statementHeading(batch) {
  if (!batch.account_id || !batch.account_name) return null;
  const facts = [
    periodLabel(batch.period_start, batch.period_end),
    batch.rows_parsed > 0 && (batch.rows_approved >= batch.rows_parsed ? `${batch.rows_parsed} row${batch.rows_parsed === 1 ? '' : 's'} saved` : `${batch.rows_approved} of ${batch.rows_parsed} rows saved`),
    batch.file_type === 'CSV' ? 'CSV' : batch.parse_method === 'local' ? 'read on this computer' : batch.parse_method ? 'read by Claude' : null,
  ].filter(Boolean);
  return { title: batch.account_name, mask: batch.account_mask ?? null, facts };
}

/**
 * The strip above a statement's rows (D335): what this statement printed, in
 * the words its kind of account uses (D360). A card: the previous and new
 * balance, payments and new charges when there were any, the year's fees and
 * interest when there were any, rewards earned, the due date. A bank account:
 * the balances, money in and out, and a savings account's interest and APY.
 * A figure that says nothing on this statement ("Spent $0.00" on a card
 * nobody used) is left out; up to six, the most telling first kept. Each has
 * a tone: money out in spend, money in in earn. Keys match where the pages
 * print them (GET /imports/:id/pages `figures`).
 * @returns [{ key, label, cents?, date?, minimum?, text?, tone? }]
 */
export function statementFigures(summary, accountType) {
  if (!summary) return [];
  const card = accountType === 'CREDIT_CARD';
  // Totals print as sizes: some readers store money out as a negative, some as a positive.
  const size = (c) => (c == null ? null : Math.abs(Number(c)));
  const some = (c) => (c == null || Number(c) === 0 ? null : c);
  const rewards = summary.cashback_cents > 0 ? summary.cashback_cents
    : summary.rewards ? ['base_cents', 'bonus_cents', 'relationship_cents'].reduce((t, k) => t + (summary.rewards[k] ?? 0), 0) || null : null;
  const year = summary.ytd_year ?? (summary.due_date ?? '').slice(0, 4);
  const savings = summary.savings ?? null;
  const all = card ? [
    { key: 'opening', label: 'Previous balance', cents: summary.opening_cents, rank: 5 },
    { key: 'payments', label: 'Payments', cents: size(some(summary.payments_cents)), tone: 'earn', rank: 4 },
    { key: 'spend', label: 'New charges', cents: size(some(summary.spend_cents)), tone: 'spend', rank: 3 },
    { key: 'closing', label: 'New balance', cents: summary.closing_cents, rank: 1 },
    { key: 'fees', label: `Fees ${year}`, cents: some(summary.ytd_fees_cents), tone: 'spend', rank: 7 },
    { key: 'interest', label: `Interest ${year}`, cents: some(summary.ytd_interest_cents), tone: 'spend', rank: 8 },
    { key: 'cashback', label: 'Rewards', cents: rewards, tone: 'earn', rank: 6 },
  ] : [
    { key: 'opening', label: 'Opening', cents: summary.opening_cents, rank: 3 },
    { key: 'payments', label: 'Money in', cents: size(some(summary.payments_cents)), tone: 'earn', rank: 4 },
    { key: 'spend', label: 'Money out', cents: size(some(summary.spend_cents)), tone: 'spend', rank: 5 },
    { key: 'closing', label: 'Closing', cents: summary.closing_cents, rank: 1 },
    { key: 'savings_interest', label: 'Interest', cents: some(savings?.interest_cents), tone: 'earn', rank: 2 },
    { key: 'apy', label: 'APY', text: savings?.apy_bps != null ? `${(savings.apy_bps / 100).toFixed(2)}%` : null, rank: 6 },
    { key: 'cashback', label: 'Cashback', cents: summary.cashback_cents > 0 ? summary.cashback_cents : null, tone: 'earn', rank: 7 },
  ];
  const out = all.filter((f) => f.cents != null || f.text != null);
  if (summary.due_date) out.push({ key: 'due', label: 'Due', date: summary.due_date, minimum: summary.minimum_cents, rank: 2 });
  // The most telling six, shown in statement order.
  const keep = new Set([...out].sort((a, b) => a.rank - b.rank).slice(0, 6));
  return out.filter((f) => keep.has(f)).map(({ rank, ...f }) => f); // eslint-disable-line no-unused-vars
}

/**
 * $0.00 lines folded away (D308 already leaves them out of Transactions):
 * "Interest charged $0.00" four times on one card. Only a clean one folds;
 * a flagged or skipped one stays where it can be seen.
 */
export const foldsAway = (row, flagged) => row.amount_cents === 0 && !flagged && row.review_status !== 'REJECTED';

/**
 * The credit line a statement's limit box shows (D360): the limit it printed,
 * else the one the household set for a card whose statements print none
 * (D354: Apple), said as theirs, with what's left as an estimate (D357).
 * The shape cardUtilisation takes; null when there's no limit at all.
 */
export function statementCreditLine(summary) {
  if (!summary) return null;
  if (summary.credit_limit_cents != null) {
    return { credit_limit_cents: summary.credit_limit_cents, available_credit_cents: summary.available_credit_cents, closing_balance_cents: summary.closing_cents, as_of: null };
  }
  if (summary.credit_limit_manual_cents != null) {
    return { credit_limit_cents: summary.credit_limit_manual_cents, available_credit_cents: null, closing_balance_cents: summary.closing_cents, as_of: null, source: 'manual' };
  }
  return null;
}
