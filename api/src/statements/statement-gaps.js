/**
 * Which of a card's statement gaps are quiet months and which are
 * statements really missing (D268).
 *
 * Card issuers don't send a statement for a cycle with no activity and
 * a $0 balance, so a month with no statement isn't always a missing
 * statement. A gap between two statements is cut into monthly cycles
 * (stepping from the earlier statement's closing day), and each cycle
 * gets a verdict from the evidence:
 *
 *   missing       something happened in it, so its statement exists:
 *                 a balance carried into it (a balance always brings a
 *                 statement), the next statement opens with a balance it
 *                 must have closed with, or a bank paid this card in it
 *                 (and the cycle before held the bill that was paid)
 *   quiet         $0 on both sides and nothing points at it
 *   likely_quiet  after the newest statement: $0 then, nothing seen
 *                 since, but no later statement to prove it. Asked once;
 *                 a "No statement this month" answer makes it quiet
 *   unknown       can't tell: a balance is missing from a statement, a
 *                 balance may have been paid from an account not in the
 *                 app, or a payment could be for another card from the
 *                 same issuer
 *
 * A payment counts only when nothing else explains it: not matched to
 * another card's statement, and, where several cards share the issuer
 * (three Amex cards), pinned to this one by being the only one without a
 * statement that day or by paying its balance to the cent.
 *
 * Also reported, as statement problems: two statements of one card that
 * overlap, and an import whose statement details (period, balances)
 * were never saved.
 *
 * Pure: rows in, verdicts out. Tested in statement-gaps.test.js.
 */

const DAY = 86_400_000;
const utc = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date, n) => iso(utc(date) + n * DAY);
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY);
/** The same day of the month, n months later; the 31st becomes the month's last day. */
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}

const MONTH = 30.44;
// Statements a few days apart, with the balance carrying over, are one
// continuous record: the dates were just printed or read loosely.
const SLACK_DAYS = 20;
// A cycle closes, then its statement takes about a week to appear.
const READY_DAYS = 7;
// Within this many cents a payment "pays the balance".
const CENTS = 1;

/** Monthly cycles from the day after `afterEnd` to `untilEnd` (inclusive), the last one ending exactly there. */
function cyclesBetween(afterEnd, untilEnd) {
  const n = Math.max(1, Math.round(daysBetween(afterEnd, untilEnd) / MONTH));
  const out = [];
  let start = addDays(afterEnd, 1);
  for (let k = 1; k <= n; k++) {
    const end = k === n ? untilEnd : addMonths(afterEnd, k);
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}

const money = (cents) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Jun 2, 2026", as the rest of the app writes a date. */
const day = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

/**
 * The calendar month a statement or cycle stands for (D269): the one whose
 * 15th it holds, where most of that month's days are. "Sep 6 – Oct 5" is
 * September, not October as its closing date would say. A short one that
 * holds no 15th takes the month of its middle day.
 */
export function monthOf(period) {
  return monthsOf(period)[0];
}

/** Every month a period stands for: each one whose 15th it holds (a long gap cycle can hold two), else its middle day's. */
export function monthsOf({ start, end }) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  for (;;) {
    const fifteenth = `${y}-${String(m).padStart(2, '0')}-15`;
    if (fifteenth > end) break;
    if (fifteenth >= start) out.push(fifteenth.slice(0, 7));
    if (m === 12) { y += 1; m = 1; } else m += 1;
  }
  return out.length > 0 ? out : [iso((utc(start) + utc(end)) / 2).slice(0, 7)];
}

/**
 * Each calendar month's state for one card (D269), by what holds its 15th:
 *   uploaded  a statement, an import's rows (even without statement details),
 *             or the few days between two statements whose balance carries over
 *   quiet / missing / ask   a gap cycle's verdict (ask: likely quiet or can't tell)
 *   upcoming  after the newest statement, a cycle not closed a week ago yet
 *   before    before the card's first statement
 */
export function monthStates({ statements, imports = [], cycles, today }) {
  const out = {};
  if (statements.length === 0) return out;
  const first = statements.map((s) => s.period_start).sort()[0];
  const last = statements.map((s) => s.period_end).sort().at(-1);
  const verdictState = { quiet: 'quiet', missing: 'missing', likely_quiet: 'ask', unknown: 'ask' };
  let [y, m] = first.split('-').map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const mid = `${key}-15`;
    if (key > today.slice(0, 7)) break;
    const cycle = cycles.find((c) => c.start <= mid && mid <= c.end);
    const statement = statements.find((s) => s.period_start <= mid && mid <= s.period_end);
    // A statement with no activity is on file, and the card was silent that month (D273).
    if (statement) out[key] = statement.no_activity ? 'quiet' : 'uploaded';
    else if (imports.some((x) => x.first_date <= mid && mid <= x.last_date)) out[key] = 'uploaded';
    else if (cycle) out[key] = verdictState[cycle.verdict];
    else if (mid < first) out[key] = 'before';
    else if (mid > last || mid > today) out[key] = 'upcoming';
    else out[key] = 'uploaded'; // between two statements that aren't a gap: the record runs on
    if (m === 12) { y += 1; m = 1; } else m += 1;
  }
  return out;
}

/**
 * @param cards     [{ id, name, issuer }] the credit cards to judge
 * @param statements [{ account_id, period_start, period_end, opening_balance_cents, closing_balance_cents }]
 *                  card balances are what's owed: positive means a balance
 * @param imports   [{ account_id, import_batch_id, first_date, last_date, has_statement }] every import of a card
 * @param payments  [{ id, posted_date, amount_cents (positive), description, account_name, issuer_key, explained_by_card_id }]
 *                  bank rows that pay a card issuer (issuer_key: which); explained_by_card_id when already matched to a card's statement
 * @param expected  [{ account_id, date, label }] charges due on a card (annual fee, a recurring bill)
 * @param answers   [{ account_id, cycle_end }] "No statement this month", by the household
 * @param today     'YYYY-MM-DD'
 */
export function judgeStatementGaps({ cards, statements, imports = [], payments = [], expected = [], answers = [], today }) {
  const byCard = new Map(cards.map((c) => [c.id, []]));
  for (const s of statements) byCard.get(s.account_id)?.push(s);
  for (const list of byCard.values()) list.sort((a, b) => a.period_end.localeCompare(b.period_end) || a.period_start.localeCompare(b.period_start));

  const answered = new Set(answers.map((a) => `${a.account_id}|${a.cycle_end}`));
  // Issuers compare by one name per issuer (payment-match.js issuerKey): "BOFA" is Bank of America.
  const keyOf = (x) => (x.issuer_key ?? x.issuer ?? '').toLowerCase();
  const openedOn = (cardId) => {
    const first = (byCard.get(cardId) ?? [])[0];
    return first && first.opening_balance_cents === 0 ? first.period_start : null;
  };
  const coversDay = (cardId, day) => (byCard.get(cardId) ?? []).some((s) => s.period_start <= day && day <= s.period_end);

  // Which card each unexplained payment is for: the one card of that issuer
  // it fits, or none (ambiguous: kept, so each candidate can say "can't tell").
  const sameIssuer = (card) => cards.filter((c) => keyOf(c) && keyOf(c) === keyOf(card));
  const forCard = (card, p) => {
    if (p.explained_by_card_id != null || keyOf(p) !== keyOf(card)) return 'other';
    // Not a card opened after it (its first statement opens at $0, D306), and not one whose statements cover the day.
    const candidates = sameIssuer(card).filter((c) => !coversDay(c.id, p.posted_date) && !(openedOn(c.id) && p.posted_date < openedOn(c.id)));
    if (!candidates.some((c) => c.id === card.id)) return 'other';
    if (candidates.length === 1) return 'this';
    const balanceOf = (c) => {
      const before = (byCard.get(c.id) ?? []).filter((s) => s.period_end < p.posted_date).at(-1);
      return before?.closing_balance_cents;
    };
    const exact = candidates.filter((c) => balanceOf(c) != null && Math.abs(balanceOf(c) - p.amount_cents) <= CENTS);
    if (exact.length === 1) return exact[0].id === card.id ? 'this' : 'other';
    return 'maybe';
  };

  const result = [];
  for (const card of cards) {
    const list = byCard.get(card.id) ?? [];
    const myPayments = payments.map((p) => ({ ...p, fit: forCard(card, p) })).filter((p) => p.fit !== 'other');
    const myExpected = expected.filter((e) => e.account_id === card.id);
    const problems = [];
    const gaps = [];

    // Statement problems: overlaps, and imports with no statement details.
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (b.period_start < a.period_end && daysBetween(b.period_start, a.period_end) > 3) {
        problems.push({ kind: 'overlap', statements: [a, b], reason: `Two statements overlap: ${day(a.period_start)} – ${day(a.period_end)} and ${day(b.period_start)} – ${day(b.period_end)}. One of the dates was probably read wrong` });
      }
    }
    for (const imp of imports.filter((x) => x.account_id === card.id && !x.has_statement && x.first_date && (x.file_type ?? 'PDF') === 'PDF')) {
      problems.push({ kind: 'details_missing', import_batch_id: imp.import_batch_id, first_date: imp.first_date, last_date: imp.last_date,
        reason: `An import with rows from ${day(imp.first_date)} to ${day(imp.last_date)} has no statement details (period, balances), so it can't be checked or shown on the calendar` });
    }

    // A cycle an import already holds rows for was uploaded: only its details are missing (reported above).
    const undetailed = imports.filter((x) => x.account_id === card.id && !x.has_statement && x.first_date); // PDF or CSV
    const uploaded = (c) => undetailed.some((x) => x.first_date <= c.end && x.last_date >= c.start);

    const judge = (allCycles, { before, after }) => {
      const cycles = allCycles.filter((c) => !uploaded(c));
      if (cycles.length === 0) return [];
      // An edge balance speaks for the cycle beside it only if that cycle is still the one here.
      const prevClose = cycles[0] === allCycles[0] ? before?.closing_balance_cents : null;
      const nextOpen = cycles.at(-1) === allCycles.at(-1) ? after?.opening_balance_cents : null;
      const verdicts = cycles.map((c) => ({ ...c, verdict: null, reasons: [], facts: [] }));
      const missing = (i, reason, fact) => {
        verdicts[i].verdict = 'missing';
        verdicts[i].reasons.push(reason);
        verdicts[i].facts.push(fact);
      };
      const maybe = (i, reason, fact) => {
        verdicts[i].maybe = [...(verdicts[i].maybe ?? []), reason];
        verdicts[i].maybeFacts = [...(verdicts[i].maybeFacts ?? []), fact];
      };
      const inCycle = (date) => verdicts.findIndex((c) => c.start <= date && date <= c.end);

      // A payment, or a charge due, falls in a cycle: that cycle has activity.
      let paidOff = -1;
      for (const p of myPayments) {
        const i = inCycle(p.posted_date);
        if (i < 0) continue;
        if (p.fit === 'maybe') {
          maybe(i, `A ${money(p.amount_cents)} payment on ${day(p.posted_date)} from ${p.account_name} isn't matched to any ${card.issuer} card. It may be for this one`,
            { kind: 'unmatched', cents: p.amount_cents, date: p.posted_date, from: p.account_name, issuer: card.issuer });
          continue;
        }
        missing(i, `${money(p.amount_cents)} was paid to it on ${day(p.posted_date)} from ${p.account_name}`,
          { kind: 'paid', cents: p.amount_cents, date: p.posted_date, from: p.account_name });
        const paysCarried = i === 0 && prevClose != null && Math.abs(prevClose - p.amount_cents) <= CENTS;
        if (paysCarried) paidOff = Math.max(paidOff, 0);
        else if (i > 0) missing(i - 1, `It most likely held the bill paid on ${day(p.posted_date)} (${money(p.amount_cents)})`,
          { kind: 'held_bill', cents: p.amount_cents, date: p.posted_date });
      }
      for (const e of myExpected) {
        const i = inCycle(e.date);
        if (i >= 0) missing(i, `${e.label} was due around ${day(e.date)}`, { kind: 'due', label: e.label, date: e.date });
      }

      // A balance carried in always brings a statement.
      if (prevClose != null && Math.abs(prevClose) > CENTS) {
        missing(0, `A balance of ${money(prevClose)} carried into it from the statement before`, { kind: 'carried', cents: prevClose });
        // Until something paid it, later cycles carried it too, unless it's unknown where it went.
        for (let i = 1; i < verdicts.length && paidOff < 0; i++) {
          if (verdicts[i].verdict === 'missing') break;
          if (!verdicts[i].verdict) maybe(i, `The ${money(prevClose)} balance may still have been owed, or paid from an account not in the app`,
            { kind: 'maybe_owed', cents: prevClose });
        }
      }
      // The next statement opens with what this cycle closed with.
      if (after && nextOpen != null && Math.abs(nextOpen) > CENTS) {
        missing(verdicts.length - 1, `The next statement opens with ${money(nextOpen)}, which this cycle's statement closed with`,
          { kind: 'next_opens', cents: nextOpen });
        if (prevClose != null && Math.abs(prevClose) <= CENTS) {
          for (let i = 0; i < verdicts.length - 1; i++) {
            if (!verdicts[i].verdict) maybe(i, `The ${money(nextOpen)} the next statement opens with may have started building up here`,
              { kind: 'text' });
          }
        }
      }

      for (const v of verdicts) {
        if (v.verdict) continue;
        const known = prevClose != null && (after ? nextOpen != null : true);
        if (v.maybe || !known) {
          v.verdict = 'unknown';
          v.reasons = v.maybe ?? [`A balance is missing from ${before && prevClose == null ? 'the statement before' : 'the statement after'}, so this can't be told`];
          v.facts = v.maybeFacts ?? v.reasons.map(() => ({ kind: 'text' }));
        } else if (after) {
          v.verdict = 'quiet';
          v.reasons = [`$0 before and after, and nothing was paid or due: no activity, so no statement`];
          v.facts = [{ kind: 'text' }];
        } else {
          v.verdict = 'likely_quiet';
          v.reasons = [`$0 at the last statement and nothing paid or due since. The next statement will confirm it`];
          v.facts = [{ kind: 'text' }];
        }
        delete v.maybe;
        delete v.maybeFacts;
      }
      for (const v of verdicts) {
        delete v.maybe;
        delete v.maybeFacts;
        v.answered = answered.has(`${card.id}|${v.end}`);
        if (v.answered && (v.verdict === 'likely_quiet' || v.verdict === 'unknown')) {
          v.verdict = 'quiet';
          v.reasons = ['You said there was no statement this month'];
          v.facts = [{ kind: 'text' }];
        } else if (v.answered && v.verdict === 'missing') {
          v.reasons.unshift('You said there was no statement this month, but');
          v.facts.unshift({ kind: 'text' });
        }
      }
      return verdicts;
    };

    // Gaps between statements.
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1];
      const after = list[i];
      const gapDays = daysBetween(before.period_end, after.period_start);
      if (gapDays <= 1) continue;
      const continuous = before.closing_balance_cents != null && before.closing_balance_cents === after.opening_balance_cents;
      if (gapDays <= 7 || (gapDays <= SLACK_DAYS && continuous)) continue;
      const cycles = cyclesBetween(before.period_end, addDays(after.period_start, -1));
      const judged = judge(cycles, { before, after });
      if (judged.length > 0) gaps.push({ after: before.period_end, before: after.period_start, trailing: false, cycles: judged });
    }

    // After the newest statement: every cycle that has closed long enough ago to have a statement.
    const last = list.at(-1);
    if (last) {
      const cycles = [];
      for (let k = 1; ; k++) {
        const end = addMonths(last.period_end, k);
        if (daysBetween(end, today) < READY_DAYS) break;
        cycles.push({ start: k === 1 ? addDays(last.period_end, 1) : addDays(addMonths(last.period_end, k - 1), 1), end });
      }
      const judged = cycles.length > 0 ? judge(cycles, { before: last, after: null }) : [];
      if (judged.length > 0) gaps.push({ after: last.period_end, before: null, trailing: true, cycles: judged });
    }

    // Statements on file for a month the card sat untouched (D273): silent months too.
    const quiet_statements = list.filter((s) => s.no_activity).map((s) => {
      const c = { start: s.period_start, end: s.period_end, verdict: 'quiet', answered: false, statement: true,
        reasons: ['The statement is on file and shows no activity'], facts: [{ kind: 'text' }] };
      return { ...c, months: monthsOf(c), month: monthOf(c) };
    });
    for (const g of gaps) for (const c of g.cycles) {
      c.months = monthsOf(c);
      c.month = c.months[0];
    }
    const months = monthStates({ statements: list, imports: undetailed, cycles: gaps.flatMap((g) => g.cycles), today });
    result.push({ account_id: card.id, name: card.name, issuer: card.issuer, gaps, problems, months, quiet_statements });
  }
  return result;
}
