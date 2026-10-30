/**
 * Review → Statements and Payments, in plain words (D310). Both tabs answer
 * one question, "what do I upload?", so both become a list of accounts, each
 * opening to the statements (or payments) behind it, one line apiece. The
 * evidence the API gathers (gap facts, payment matches) is boiled down to the
 * single clue that says why; the rest stays out of sight. Pure; tested in
 * upload-view.test.js.
 */
import { formatMoney, formatShortDate } from '../../api.js';
import { cycleRange, statementMonth } from './statement-gaps-view.js';

/** The clue that best says a statement exists, strongest first. */
const CLUE_ORDER = ['paid', 'carried', 'held_bill', 'next_opens', 'due', 'unmatched'];

/** One short line for why a statement is missing: "Paid $80.79 on Jan 21". */
export function clueFor(cycle) {
  const facts = cycle.facts ?? [];
  const fact = CLUE_ORDER.map((k) => facts.find((f) => f?.kind === k)).find(Boolean);
  switch (fact?.kind) {
    case 'paid': return `Paid ${formatMoney(fact.cents)} on ${formatShortDate(fact.date)}`;
    case 'carried': return `Owed ${formatMoney(fact.cents)} going in`;
    case 'held_bill': return `Its bill was paid ${formatShortDate(fact.date)}`;
    case 'next_opens': return `Next one opens at ${formatMoney(fact.cents)}`;
    case 'due': return `${fact.label ?? 'A charge'} was due`;
    case 'unmatched': return `Maybe paid ${formatMoney(fact.cents)} on ${formatShortDate(fact.date)}`;
    default: return 'Activity that month';
  }
}

const span = (statements) => {
  if (statements.length === 1) return statements[0].month;
  const first = statements.at(-1).month;
  const last = statements[0].month;
  return first.slice(-4) === last.slice(-4) ? `${first.slice(0, 3)} – ${last}` : `${first} – ${last}`;
};

/** Missing statements per account, newest first, each with its one clue. */
export function missingStatements(upload = []) {
  return upload.map((u) => {
    const statements = u.cycles
      .slice()
      .sort((a, b) => b.end.localeCompare(a.end))
      .map((c) => ({ key: c.end, month: statementMonth(c), dates: cycleRange(c), clue: clueFor(c) }));
    return { account_id: u.account_id, name: u.name, mask: u.mask, count: statements.length, span: span(statements), statements };
  });
}

const monthKey = (iso) => iso.slice(0, 7);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const named = (name, mask) => `${name}${mask ? ` ··${mask}` : ''}`;

/**
 * Payments seen on one side only, grouped by the account whose statement
 * would show the other side. A card payment with no bank row waits on a bank
 * statement ("To Blue Cash ··5105"); a bank bill with no card row waits on a
 * card statement ("From Chase ··5106"). Each account opens to its months,
 * newest first, and each month to its payments. Those no upload can match
 * (every statement is here and none shows it, or the bank row names no card)
 * are grouped apart, `uploadable: false`.
 */
export function paymentsToTrace(payments = [], cardBills = []) {
  const groups = new Map();
  const group = (key, init) => {
    if (!groups.has(key)) groups.set(key, { key, count: 0, cents: 0, waiting: 0, lines: [], uploadable: true, ...init });
    return groups.get(key);
  };

  for (const p of payments) {
    const src = p.payment_source ?? {};
    if (src.status !== 'unverified' && src.status !== 'named') continue;
    const bank = src.likely;
    // Every bank statement is here and none shows it: it came from somewhere not in the app.
    const g = src.reason === 'no_match'
      ? group('none:bank', { kind: 'bank', account_id: null, name: 'Paid from an account not in the app', mask: null, uploadable: false })
      : src.reason === 'ambiguous'
        ? group('none:ambiguous', { kind: 'bank', account_id: null, name: 'More than one bank row fits', mask: null, uploadable: false })
        : bank
          ? group(`bank:${bank.account_id}`, { kind: 'bank', account_id: bank.account_id, name: bank.account_name, mask: bank.mask })
          : group('none:bank', { kind: 'bank', account_id: null, name: 'Paid from an account not in the app', mask: null, uploadable: false });
    if (src.status === 'named') g.waiting += 1;
    else { g.count += 1; g.cents += Math.abs(p.amount_cents); }
    g.lines.push({ key: `p${p.transaction_id}`, date: p.posted_date, cents: Math.abs(p.amount_cents), text: `To ${named(p.account_name, p.account_mask)}`, waiting: src.status === 'named' });
  }

  for (const b of cardBills) {
    const names = [...new Set(b.candidates ?? [])];
    const g = b.reason === 'card_not_in_app' || b.reason === 'unknown_card' || b.reason === 'not_on_card'
      ? group(`none:${b.reason}:${b.issuer ?? ''}`, {
        kind: 'card', account_id: null, mask: null, uploadable: false,
        name: b.reason === 'card_not_in_app' ? `A ${b.issuer} card not in the app`
          : b.reason === 'unknown_card' ? 'A card the bank didn\'t name' : `Not on any ${b.issuer} card here`,
      })
      : b.card
      ? group(`card:${b.card.id}`, { kind: 'card', account_id: b.card.id, name: b.card.name, mask: b.card.mask })
      : group(`issuer:${b.issuer ?? names.join('|')}`, {
        kind: 'card', account_id: null, mask: null,
        name: names.length ? names.join(' or ') : `A ${b.issuer ?? 'card'} card`,
        // Two cards with one name (two Zolve cards): it's one of them, the bank row can't say which.
        either: names.length === 1 && (b.candidates ?? []).length > 1,
      });
    for (const bill of b.bills ?? []) {
      g.count += 1;
      g.cents += bill.cents;
      g.lines.push({ key: `b${bill.id}`, date: bill.date, cents: bill.cents, text: bill.account_name ? `From ${named(bill.account_name, bill.mask)}` : 'From a bank account', waiting: false });
    }
  }

  return [...groups.values()]
    .map((g) => {
      const months = new Map();
      for (const l of g.lines.sort((a, b) => b.date.localeCompare(a.date))) {
        const k = monthKey(l.date);
        if (!months.has(k)) months.set(k, { key: k, label: monthLabel(k), lines: [] });
        months.get(k).lines.push(l);
      }
      const list = [...months.values()];
      const range = list.length === 1 ? list[0].label : `${list.at(-1).label} – ${list[0].label}`;
      return { ...g, months: list, range };
    })
    .sort((a, b) => b.uploadable - a.uploadable || b.count - a.count || b.waiting - a.waiting || a.name.localeCompare(b.name));
}
