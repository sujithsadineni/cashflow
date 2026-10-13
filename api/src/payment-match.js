/**
 * Where each card payment came from (D199). Pure: rows in, links out.
 * Tested in payment-match.test.js; written by payment-match-run.js.
 *
 * A card's "MOBILE PAYMENT - THANK YOU" is matched to the bank row it
 * came from:
 *   - the same amount to the cent, going out of a non-card account
 *   - the bank date from 6 days before to 5 days after the card's
 *     (real data: the bank 0–4 days after the card, around weekends; Zolve
 *     posts its payment 4 days after the bank sends it)
 *   - the bank row looks like a card bill: it names the card's issuer,
 *     or is typed payment/transfer, or is filed as Card Payment. So a
 *     $6.62 coffee never verifies a $6.62 payment
 *   - naming the issuer beats not naming it; the closer date breaks ties
 *   - two bank rows equally good: ambiguous, never a guess
 *   - one bank row verifies at most one payment (best scores first)
 *
 * Not found, it says why:
 *   - statement_missing: some bank account has no statement covering the
 *     window, so the payment may be on it. The likely one is where this
 *     card's payments of the same kind (autopay or not) usually come
 *     from, among those missing. Upload it and a re-run verifies it
 *   - no_match: every bank account is covered and none has it — paid
 *     from an account not in the app
 */

const DAY = 86_400_000;
export const BEFORE_DAYS = 6;
export const AFTER_DAYS = 5;

const utc = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const shift = (iso, days) => new Date(utc(iso) + days * DAY).toISOString().slice(0, 10);

// How each issuer appears on a bank's side ("AMEX EPAYMENT ACH PMT",
// "Applecard Gsbank Payment", "BARCLAYCARD US CREDITCARD").
const ISSUER_NAMES = [
  [/american express|amex/i, /amex|american express/i, 'American Express'],
  [/barclays/i, /barclay/i, 'Barclays'],
  [/goldman|apple/i, /apple ?card|gsbank|goldman/i, 'Apple Card'],
  [/bank of america|^bofa$/i, /bank of america|\bbofa\b|\bboa\b/i, 'Bank of America'],
  [/chase/i, /chase/i, 'Chase'],
  [/bilt/i, /bilt/i, 'Bilt'],
  [/zolve/i, /zolve/i, 'Zolve'],
  [/robinhood/i, /robinhood/i, 'Robinhood'],
  [/discover/i, /discover/i, 'Discover'],
  [/citi/i, /\bciti/i, 'Citi'],
  [/capital one/i, /capital one|capone/i, 'Capital One'],
];

/** Does this bank description name the card's issuer? */
export function namesIssuer(description, issuer) {
  if (!issuer) return false;
  const hit = ISSUER_NAMES.find(([who]) => who.test(issuer));
  if (hit) return hit[1].test(description ?? '');
  const word = issuer.split(/\s+/)[0];
  return word.length >= 3 && new RegExp(`\\b${word.replace(/[^a-z0-9]/gi, '')}`, 'i').test(description ?? '');
}

const looksLikeBill = (t, issuer) =>
  namesIssuer(t.description, issuer) || t.txn_type === 'payment' || t.txn_type === 'transfer' || t.category_name === 'Card Payment';

const isAutopay = (t) => /autopay/i.test(t.description ?? '');

/** Is every day from `from` to `to` inside one of these statement periods? */
export function covered(periods, from, to) {
  let day = from;
  const sorted = [...periods].sort((a, b) => a.period_start.localeCompare(b.period_start));
  for (const p of sorted) {
    if (p.period_start.slice(0, 10) > day) break;
    if (p.period_end.slice(0, 10) >= day) day = shift(p.period_end, 1);
    if (day > to) return true;
  }
  return day > to;
}

// --- D200: payments that didn't leave a bank as one row ---

/** Paid in cash at a bank's ATM or branch: no bank row exists to find. */
const CASH = /\bATM PAYMENT\b|\bCASH PAYMENT\b|\bBRANCH PAYMENT\b/i;
export const isCashPayment = (description) => CASH.test(description ?? '');
/** "ATM PAYMENT   RIVERTON   NC" -> "Riverton, NC" */
export function cashLocation(description) {
  const m = /ATM PAYMENT\s+(.+?)\s*$/i.exec(description ?? '');
  if (!m) return null;
  const words = m[1].trim().split(/\s+/);
  const state = words.length > 1 && /^[A-Z]{2}$/.test(words.at(-1)) ? words.pop() : null;
  const city = words.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  return state ? `${city}, ${state}` : city;
}

// Banks a card's payment line can name as its source.
const SOURCE_BANKS = [
  [/\bsofi\b/i, /sofi/i],
  [/\bchase\b/i, /chase/i],
  [/bank of america|\bbofa\b/i, /bank of america/i],
  [/wells fargo/i, /wells/i],
  [/capital one/i, /capital one/i],
];

/**
 * Where the card's own line says the money came from: "Online payment
 * from CHK 5504", "Payment Received SOFI BANK, NA", "Bill Payment from
 * Chase". An account when it can tell which, else just the bank.
 * "BA ELECTRONIC PAYMENT" names nothing: that's how BofA prints a payment
 * from any BofA account, the household's or someone else's.
 * @returns { account_id, issuer } | null
 */
export function namedSource(description, bankAccounts) {
  const text = description ?? '';
  const mask = /\b(?:CHK|CHECKING|SAVINGS|ACCOUNT ENDING(?: IN)?)\s*#?\s*(\d{4})\b/i.exec(text)?.[1];
  if (mask) {
    const acct = bankAccounts.find((a) => a.mask === mask);
    return acct ? { account_id: acct.id, issuer: acct.issuer ?? null } : null;
  }
  const hit = SOURCE_BANKS.find(([onCard]) => onCard.test(text));
  if (!hit) return null;
  const mine = bankAccounts.filter((a) => hit[1].test(a.issuer ?? ''));
  if (mine.length === 0) return null;
  return { account_id: mine.length === 1 ? mine[0].id : null, issuer: mine[0].issuer };
}

const PERSON_DAYS = 10;
const isZelleOut = (r) => r.amount_cents < 0 && r.zelle_type !== 'INTERNAL' && (r.category_name === 'Zelle' || /zelle/i.test(r.description ?? ''));
const personOf = (r) => (r.contact_id ? `c${r.contact_id}` : r.zelle_person ? `z${r.zelle_person.toLowerCase()}` : null);

/** Every combination of 1..max rows from `rows` (small lists only). */
function combos(rows, max) {
  const out = [];
  const walk = (start, picked) => {
    if (picked.length > 0) out.push(picked);
    if (picked.length === max) return;
    for (let i = start; i < rows.length; i++) walk(i + 1, [...picked, rows[i]]);
  };
  walk(0, []);
  return out;
}

/**
 * @param payments      card rows to explain: { id, account_id, posted_date, amount_cents (> 0), description, issuer }
 * @param bankRows      money out of non-card accounts: { id, account_id, posted_date, amount_cents (< 0), description, txn_type, category_name, zelle_type, zelle_person, contact_id, contact_name }
 * @param bankAccounts  { id, issuer, mask, periods: [{ period_start, period_end }] }
 * @param taken         row ids already linked to payments not being matched now
 * @returns [{ card_transaction_id, bank_transaction_id, status, reason, via, part_ids, detail }]
 *
 * In order, first that fits wins:
 *   1. bank      one bank row, same amount (D199)
 *   2. cash      the card line says ATM/cash payment
 *   3. bank      two bank rows from one account that add up, both naming the issuer
 *   4. person    someone else paid it: 1–3 Zelles to one person, ±10 days, adding up
 *                (skipped when the card line names the household's own bank)
 *   5. named     the card line names the source, its statement isn't here: 'named'
 *   6. unverified, with why (D199)
 */
export function matchPayments({ payments, bankRows, bankAccounts, taken = [] }) {
  const result = new Map();
  const used = new Set(taken);
  const set = (p, m) => result.set(p.id, { card_transaction_id: p.id, bank_transaction_id: null, reason: null, part_ids: [], ...m });
  const offset = (r, p) => (utc(r.posted_date) - utc(p.posted_date)) / DAY;
  const inWindow = (r, p) => offset(r, p) >= -BEFORE_DAYS && offset(r, p) <= AFTER_DAYS;

  // 1. One bank row. Best pairs first, each row used once; an equal tie is ambiguous.
  const byAmount = new Map();
  for (const r of bankRows) {
    if (!byAmount.has(r.amount_cents)) byAmount.set(r.amount_cents, []);
    byAmount.get(r.amount_cents).push(r);
  }
  const options = new Map();
  for (const p of payments) {
    options.set(p.id, (byAmount.get(-p.amount_cents) ?? [])
      .filter((r) => inWindow(r, p) && looksLikeBill(r, p.issuer) && !isZelleOut(r))
      .map((r) => ({ r, score: (namesIssuer(r.description, p.issuer) ? 0 : 10) + Math.abs(offset(r, p)) }))
      .sort((a, b) => a.score - b.score || a.r.id - b.r.id));
  }
  const pairs = payments.flatMap((p) => options.get(p.id).map((o) => ({ p, ...o }))).sort((a, b) => a.score - b.score || a.p.id - b.p.id);
  for (const { p, r, score } of pairs) {
    if (result.has(p.id) || used.has(r.id)) continue;
    const rivals = options.get(p.id).filter((o) => o.score === score && !used.has(o.r.id));
    if (rivals.length > 1) {
      set(p, { status: 'unverified', reason: 'ambiguous', via: 'bank', detail: { candidate_ids: rivals.map((o) => o.r.id) } });
      continue;
    }
    used.add(r.id);
    set(p, { bank_transaction_id: r.id, part_ids: [r.id], status: 'verified', via: 'bank', detail: { bank_account_id: r.account_id, days: offset(r, p) } });
  }

  // 2. Cash at an ATM or branch.
  for (const p of payments) {
    if (!result.has(p.id) && isCashPayment(p.description)) {
      set(p, { status: 'verified', via: 'cash', detail: { location: cashLocation(p.description) } });
    }
  }

  // 3 and 4: combinations, best-first across all payments, every row used once.
  const open = () => payments.filter((p) => !result.has(p.id));
  const assign = (candidates, make) => {
    candidates.sort((a, b) => a.score - b.score || a.p.id - b.p.id);
    for (const c of candidates) {
      if (result.has(c.p.id) || c.rows.some((r) => used.has(r.id))) continue;
      const rival = candidates.find((o) => o !== c && o.p === c.p && o.score === c.score && !o.rows.some((r) => used.has(r.id)));
      if (rival) continue; // two equally good ways: leave it to the next stage, never guess
      c.rows.forEach((r) => used.add(r.id));
      set(c.p, make(c));
    }
  };

  // 3. Two bank rows from one account that add up, both naming the card's issuer.
  const split = [];
  for (const p of open()) {
    const rows = bankRows.filter((r) => !used.has(r.id) && inWindow(r, p) && namesIssuer(r.description, p.issuer) && -r.amount_cents < p.amount_cents);
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].account_id === rows[j].account_id && -(rows[i].amount_cents + rows[j].amount_cents) === p.amount_cents) {
          split.push({ p, rows: [rows[i], rows[j]], score: 20 + Math.abs(offset(rows[i], p)) + Math.abs(offset(rows[j], p)) });
        }
      }
    }
  }
  assign(split, (c) => ({ bank_transaction_id: c.rows[0].id, part_ids: c.rows.map((r) => r.id), status: 'verified', via: 'bank', detail: { bank_account_id: c.rows[0].account_id, split: true } }));

  // 4. Someone else paid it and was paid back by Zelle.
  const named = new Map(payments.map((p) => [p.id, namedSource(p.description, bankAccounts)]));
  const zelles = bankRows.filter((r) => isZelleOut(r) && personOf(r));
  const viaPerson = [];
  for (const p of open()) {
    if (named.get(p.id)) continue;
    const near = zelles.filter((r) => !used.has(r.id) && Math.abs(offset(r, p)) <= PERSON_DAYS);
    const byPerson = new Map();
    for (const r of near) {
      if (!byPerson.has(personOf(r))) byPerson.set(personOf(r), []);
      byPerson.get(personOf(r)).push(r);
    }
    for (const rows of byPerson.values()) {
      for (const combo of combos(rows.slice(0, 8), 3)) {
        if (-combo.reduce((t, r) => t + r.amount_cents, 0) === p.amount_cents) {
          viaPerson.push({ p, rows: combo, score: combo.length * 10 + combo.reduce((t, r) => t + Math.abs(offset(r, p)), 0) });
        }
      }
    }
  }
  assign(viaPerson, (c) => ({
    part_ids: c.rows.map((r) => r.id),
    status: 'verified',
    via: 'person',
    detail: { person: c.rows[0].contact_name ?? c.rows[0].zelle_person, contact_id: c.rows[0].contact_id ?? null, zelle_count: c.rows.length },
  }));

  // 5 and 6: not found. The likely bank is where this card's payments of the
  // same kind came from most often — or the one the card line names.
  const bankOf = new Map(bankRows.map((r) => [r.id, r.account_id]));
  const periodsOf = new Map(bankAccounts.map((a) => [a.id, a.periods]));
  for (const p of payments) {
    if (result.has(p.id)) continue;
    const from = shift(p.posted_date, -BEFORE_DAYS);
    const to = shift(p.posted_date, AFTER_DAYS);
    const history = payments.filter((o) => o.account_id === p.account_id && result.get(o.id)?.via === 'bank' && result.get(o.id)?.status === 'verified');
    const sameKind = history.filter((o) => isAutopay(o) === isAutopay(p));
    const counts = new Map();
    for (const o of sameKind.length > 0 ? sameKind : history) {
      const acct = bankOf.get(result.get(o.id).bank_transaction_id);
      counts.set(acct, (counts.get(acct) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const coveredUntil = (id) => (periodsOf.get(id) ?? []).reduce((m, s) => (s.period_end.slice(0, 10) > m ? s.period_end.slice(0, 10) : m), '') || null;
    const coveredFrom = (id) => (periodsOf.get(id) ?? []).reduce((m, s) => (!m || s.period_start.slice(0, 10) < m ? s.period_start.slice(0, 10) : m), '') || null;

    // "No match" only when every bank account is covered for the window:
    // while any statement is missing, the payment may be on it.
    const uncovered = bankAccounts.filter((a) => !covered(a.periods, from, to)).map((a) => a.id);
    const source = named.get(p.id);
    const missing = source?.account_id != null ? uncovered.includes(source.account_id) : uncovered.length > 0;
    const likely = source?.account_id
      ?? (uncovered.length > 0 ? ranked.find((id) => uncovered.includes(id)) ?? (uncovered.length === 1 ? uncovered[0] : null) : ranked[0] ?? null);
    set(p, {
      status: source ? 'named' : 'unverified',
      via: source ? 'statement' : 'bank',
      reason: missing ? 'statement_missing' : 'no_match',
      detail: {
        likely_account_id: likely,
        named_issuer: source?.issuer ?? null,
        covered_from: likely != null ? coveredFrom(likely) : null,
        covered_until: likely != null ? coveredUntil(likely) : null,
        uncovered_account_ids: uncovered,
        window: { from, to },
      },
    });
  }

  return payments.map((p) => result.get(p.id));
}

/**
 * The other direction (D199 step 3): card bills paid from a bank that no
 * card payment matched. Replaces the retired card_untracked rule, which
 * re-typed them as purchases. Grouped by card and month, each says why:
 *   - card_statement_missing: a card from that issuer is in the app, but
 *     its statements don't cover the bill's week (any such card)
 *   - not_on_card: every card from that issuer is covered and none shows
 *     the payment (another card from that issuer not in the app, or a
 *     split payment)
 *   - card_not_in_app: no card from that issuer is in the app
 *   - unknown_card: the bill doesn't name an issuer
 *
 * @param bills  unmatched bank rows: { id, posted_date, amount_cents (< 0), description }
 * @param cards  card accounts: { id, name, issuer, mask, periods: [{ period_start, period_end }] }
 * @returns [{ key, reason, issuer, card: { id, name, mask } | null, month, count, total_cents, transaction_ids, covered_from, covered_until }]
 */
export function explainUnlinkedBills({ bills, cards }) {
  const groups = new Map();
  for (const b of bills) {
    const mine = cards.filter((c) => namesIssuer(b.description, c.issuer));
    const end = shift(b.posted_date, AFTER_DAYS + BEFORE_DAYS);
    // While any card from that issuer isn't covered, the payment may be on it.
    const uncovered = mine.filter((c) => !covered(c.periods, b.posted_date, end));
    const pool = uncovered.length > 0 ? uncovered : mine;
    const card = pool.length === 1 ? pool[0] : null;
    const printed = ISSUER_NAMES.find(([, onBank]) => onBank.test(b.description ?? ''))?.[2] ?? null;
    const reason = mine.length === 0 ? (printed ? 'card_not_in_app' : 'unknown_card') : uncovered.length > 0 ? 'card_statement_missing' : 'not_on_card';
    const issuer = mine[0]?.issuer ?? printed;
    const month = b.posted_date.slice(0, 7);
    const key = `${reason}|${card?.id ?? issuer ?? 'other'}|${month}`;
    if (!groups.has(key)) {
      const ends = (card?.periods ?? []).map((p) => [p.period_start.slice(0, 10), p.period_end.slice(0, 10)]);
      groups.set(key, {
        key, reason, issuer,
        card: card ? { id: card.id, name: card.name, mask: card.mask ?? null } : null,
        // Which cards it could be on, when it isn't just one.
        candidates: card ? [] : pool.map((c) => c.name),
        label: card ? null : b.description,
        month, count: 0, total_cents: 0, transaction_ids: [],
        covered_from: ends.length ? ends.map((e) => e[0]).sort()[0] : null,
        covered_until: ends.length ? ends.map((e) => e[1]).sort().at(-1) : null,
      });
    }
    const g = groups.get(key);
    g.count++;
    g.total_cents += -b.amount_cents;
    g.transaction_ids.push(b.id);
  }
  return [...groups.values()].sort((a, b) => b.month.localeCompare(a.month));
}
