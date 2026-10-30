/**
 * The Alerts page in plain words (D315). Three questions, in order:
 *   needsYou   what to do now, worst first, each with the one action that fixes it
 *   comingUp   what lands in the next two weeks: card bills, recurring charges,
 *              a 0% promo ending, grouped by day
 *   cleared    what was dealt with, by month, from the alert history
 * Built from what the app already has (GET /alerts, accounts, recurring bills,
 * loans), so nothing here is stored twice. Pure; tested in alert-feed.test.js.
 */
import { formatMoney } from '../../api.js';
import { monthLong } from '../app/dates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
const named = (name, mask) => `${name}${mask ? ` ··${mask}` : ''}`;
const utc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const between = (from, to) => Math.round((utc(to) - utc(from)) / 86_400_000);

/** "in 1 day" → "tomorrow"; past dates as "late". */
function when(daysLeft) {
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  if (daysLeft > 1) return `in ${days(daysLeft)}`;
  return `${days(-daysLeft)} late`;
}

/** Worst first: money already late, money due soon, records missing, a card near its limit, bills further off, then things to look at. */
const RANK = { pay_late: 0, pay_soon: 1, statement: 2, bill: 3, usage: 4, pay_upcoming: 5, payments: 6, review: 7, new_bill: 8, spend: 9, terms: 10 };
/** The last days before a bill is due, when its ring turns amber (D361). */
export const DUE_SOON_DAYS = 5;

const pct = (bps) => `${(bps / 100).toFixed(2)}%`;
const changeWords = (c) => (c.field === 'apr' ? `APR ${pct(c.from)} → ${pct(c.to)}` : `limit ${formatMoney(c.from)} → ${formatMoney(c.to)}`);

/**
 * A card's APR or limit that changed on its newest statement (D349), as feed
 * items. Variable APRs move together when the market rate does, so APR-only
 * changes of the same size on two or more cards are one item ("APR up 0.25%
 * on 7 cards"); a limit change, or an APR that moved differently, is its
 * card's own. For information: they count under no tile.
 */
export function termsItems(list = []) {
  const aprOnly = list.filter((t) => t.changes.length === 1 && t.changes[0].field === 'apr');
  const byDelta = new Map();
  for (const t of aprOnly) {
    const d = t.changes[0].to - t.changes[0].from;
    byDelta.set(d, [...(byDelta.get(d) ?? []), t]);
  }
  const grouped = new Set([...byDelta.values()].filter((g) => g.length > 1).flat());
  const out = [];
  for (const [d, group] of byDelta) {
    if (group.length < 2) continue;
    const names = group.map((t) => t.account_name);
    const latest = group.map((t) => t.period_end).sort().at(-1);
    out.push({
      key: 'terms:apr', ref: `${d}:${latest}`, kind: 'terms', tile: null, urgent: false,
      title: `APR ${d > 0 ? 'up' : 'down'} ${pct(Math.abs(d))} on ${group.length} cards`,
      subtitle: `The same move on each: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2} more` : ''}`,
      cents: null, days: null, action: { label: 'Cards', to: '/cards' },
    });
  }
  for (const t of list.filter((x) => !grouped.has(x))) {
    out.push({
      key: `terms:${t.account_id}`, ref: t.period_end, kind: 'terms', tile: null, urgent: false,
      title: `${named(t.account_name, t.mask)}: ${t.changes.map(changeWords).join(' · ')}`,
      subtitle: `On the statement closing ${day(t.period_end)}`,
      cents: null, days: null, action: { label: 'Card', to: `/cards?account=${t.account_id}` }, account_id: t.account_id,
    });
  }
  return out;
}

/**
 * A terms-change notice (D350), one item per notice: two cards from one bank
 * that got the same notice are one item. Urgent in the week before its
 * reject-by date. For information: no tile counts it.
 */
export function noticeItems(list = [], today = '') {
  const groups = new Map();
  for (const n of list) {
    const k = `${n.effective_on}|${JSON.stringify(n.points ?? [])}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  return [...groups.values()].map((group) => {
    const n = group[0];
    const cards = group.map((g) => named(g.account_name, g.mask));
    const ahead = today ? between(today, n.effective_on) : 1;
    const rejectIn = n.reject_by && today ? between(today, n.reject_by) : null;
    return {
      key: `notice:${group.map((g) => g.account_id).join('+')}`, ref: n.effective_on, kind: 'terms', tile: null,
      urgent: rejectIn != null && rejectIn >= 0 && rejectIn <= 7,
      title: `${cards.length > 1 ? `${cards.slice(0, -1).join(', ')} and ${cards.at(-1)}` : cards[0]}: terms ${ahead >= 0 ? 'change' : 'changed'} ${day(n.effective_on)}`,
      subtitle: [(n.points ?? []).slice(0, 2).join(' · ') || null, rejectIn != null && rejectIn >= 0 ? `reject by ${day(n.reject_by)}` : null].filter(Boolean).join(' · '),
      cents: null, days: ahead >= 0 ? ahead : null,
      action: { label: 'Card', to: `/cards?account=${n.account_id}` }, account_id: group.length === 1 ? n.account_id : undefined,
    };
  });
}

/** Whether an answer (D318) hides this item: for good, or until its day, for this occurrence. */
export const isAnswered = (item, snoozed = [], today = '') =>
  snoozed.some((s) => s.key === item.key && (!s.ref || s.ref === (item.ref ?? '')) && (!s.until || s.until >= today));

/**
 * What needs doing now, from GET /alerts, less what's been snoozed,
 * dismissed or marked paid (D318). Each item says which tile it counts
 * under, its amount, and days left (negative: late) for the ring.
 * @returns [{ key, ref, kind, tile, urgent, title, subtitle, cents, days, action, account_id?, merchant? }]
 */
export function needsYou(live, today = '') {
  if (!live) return [];
  const out = [];
  for (const p of live.card_payments_due ?? []) {
    const late = p.status === 'overdue' || p.days_left < 0;
    // Every unpaid bill from the day its statement closes (D361); further off than a few days, it waits lower down.
    const kind = late ? 'pay_late' : p.days_left <= DUE_SOON_DAYS ? 'pay_soon' : 'pay_upcoming';
    out.push({
      key: `pay:${p.account_id}`, ref: p.due_date, kind, tile: 'pay', urgent: late || p.days_left <= 1,
      title: `Pay ${named(p.account_name, p.mask)}`,
      // The amount is the card's headline; the line says when (D318), and the minimum when it's less (D361):
      // a balance carried on purpose (a transfer on a promo) only needs that.
      subtitle: `Due ${day(p.due_date)} · ${when(p.days_left)}${p.minimum_remaining_cents != null && p.minimum_remaining_cents < p.remaining_cents ? ` · min ${formatMoney(p.minimum_remaining_cents)}` : ''}`,
      cents: p.remaining_cents, days: p.days_left,
      action: { label: 'Card', to: `/cards?account=${p.account_id}` }, account_id: p.account_id,
    });
  }
  for (const s of live.overdue_statements ?? []) {
    out.push({
      key: `stmt:${s.account_id}`, ref: s.expected_by, kind: 'statement', tile: 'upload', urgent: s.days_overdue > 14,
      title: `Upload ${named(s.account_name, s.mask)}'s statement`,
      // Named by its own dates (D320), not the reminder's: "Aug 18 – Sep 17 · closed 31 days ago".
      subtitle: s.closed_on
        ? `${s.period_start ? `${day(s.period_start)} – ` : ''}${day(s.closed_on)} · closed ${today ? days(between(s.closed_on, today)) + ' ago' : day(s.closed_on)}`
        : `Expected ${day(s.expected_by)} · ${days(s.days_overdue)} late`,
      cents: null, days: s.closed_on && today ? -between(s.closed_on, today) : -s.days_overdue,
      action: { label: 'Upload', to: '/import' }, account_id: s.account_id,
    });
  }
  for (const b of live.missed_recurring ?? []) {
    out.push({
      key: `bill:${b.id}`, ref: b.expected_date, kind: 'bill', tile: 'bills', urgent: false,
      title: `${b.name} hasn't charged`,
      subtitle: `Expected ${day(b.expected_date)}`,
      cents: b.expected_amount_cents ? Math.abs(b.expected_amount_cents) : null, days: today ? -between(b.expected_date, today) : null,
      action: { label: 'Recurring', to: `/recurring?bill=${b.id}` }, merchant: b.name,
    });
  }
  const unknown = live.payments_unknown?.length ?? 0;
  if (unknown > 0) {
    out.push({
      key: 'payments', ref: '', kind: 'payments', tile: 'review', urgent: false,
      title: `${unknown} card ${unknown === 1 ? 'payment' : 'payments'} to match`,
      subtitle: 'Seen on the card, not yet in a bank statement', cents: null, days: null, count: unknown,
      action: { label: 'Review', to: '/review?tab=payments' },
    });
  }
  const review = (live.pending_review ?? []).reduce((n, r) => n + (r.count ?? 1), 0);
  if (review > 0) {
    out.push({
      key: 'review', ref: '', kind: 'review', tile: 'review', urgent: false,
      title: `${review} ${review === 1 ? 'row' : 'rows'} to review`, subtitle: 'From a statement you uploaded', cents: null, days: null, count: review,
      action: { label: 'Review', to: '/review' },
    });
  }
  for (const c of live.new_recurring ?? []) {
    out.push({
      key: `new:${c.match_name_contains}`, ref: '', kind: 'new_bill', tile: 'bills', urgent: false,
      title: `New recurring: ${c.name}`,
      subtitle: `${c.cadence ? c.cadence.toLowerCase() : 'repeats'}${c.expected_amount_cents ? ` · ~${formatMoney(Math.abs(c.expected_amount_cents))}` : ''}`,
      cents: null, days: null,
      action: { label: 'Confirm', to: '/recurring?bill=new' }, merchant: c.name,
    });
  }
  // A card near its limit (D361): 30% or more of it on its newest statement; urgent from 90%.
  for (const u of live.card_high_use ?? []) {
    out.push({
      key: `use:${u.account_id}`, ref: u.period_end, kind: 'usage', tile: null, urgent: u.pct >= 90,
      title: `${named(u.account_name, u.mask)}: ${u.pct}% of ${u.manual ? 'your' : 'its'} limit used`,
      subtitle: `${formatMoney(u.used_cents)} of ${formatMoney(u.limit_cents)} · statement closing ${day(u.period_end)}`,
      cents: null, days: null, action: { label: 'Card', to: `/cards?account=${u.account_id}` }, account_id: u.account_id,
    });
  }
  // A card spending twice its usual or more (D361).
  for (const j of live.card_spend_jumps ?? []) {
    out.push({
      key: `spend:${j.account_id}`, ref: j.period_end, kind: 'spend', tile: null, urgent: false,
      title: `${named(j.account_name, j.mask)}: spending ${j.ratio}× usual`,
      subtitle: `${formatMoney(j.spend_cents)} on the statement closing ${day(j.period_end)} · usually about ${formatMoney(j.usual_cents)}`,
      cents: null, days: null, action: { label: 'Card', to: `/cards?account=${j.account_id}` }, account_id: j.account_id,
    });
  }
  out.push(...termsItems(live.card_terms_changed), ...noticeItems(live.terms_notices, today));
  return out
    .filter((i) => !isAnswered(i, live.snoozed, today))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || Number(b.urgent) - Number(a.urgent));
}

/** The four tiles over the list: what to pay, upload, chase and match. */
export function tiles(items) {
  const of = (t) => items.filter((i) => i.tile === t);
  const sum = (list) => list.reduce((n, i) => n + (i.cents ?? 0), 0);
  return {
    pay: { count: of('pay').length, cents: sum(of('pay')) },
    upload: { count: of('upload').length },
    bills: { count: of('bills').length, cents: sum(of('bills')) },
    review: { count: of('review').reduce((n, i) => n + (i.count ?? 1), 0) },
  };
}

/**
 * What lands in the next `horizon` days, grouped by day, soonest first. A
 * card bill already in needsYou (due soon or late) isn't repeated here.
 * @returns [{ date, label, items: [{ key, title, subtitle, cents, account_id?, merchant? }] }]
 */
export function comingUp({ accounts = [], bills = [], loans = [], today, horizon = 14, skip = new Set(), snoozed = [] }) {
  const items = [];
  const inRange = (iso) => iso && iso >= today && between(today, iso) <= horizon;
  for (const a of accounts) {
    const due = a.payment_due;
    if (!due || !inRange(due.due_date) || skip.has(`pay:${a.id}`)) continue;
    if (isAnswered({ key: `pay:${a.id}`, ref: due.due_date }, snoozed, today)) continue;
    if (!['due', 'due_soon'].includes(due.status) || !due.remaining_cents) continue;
    items.push({ key: `card:${a.id}`, date: due.due_date, title: `${named(a.name, a.mask)} bill`, subtitle: 'Card payment due', cents: due.remaining_cents, account_id: a.id });
  }
  for (const b of bills) {
    if (b.status !== 'ACTIVE' || !inRange(b.next_date)) continue;
    items.push({ key: `bill:${b.id}`, date: b.next_date, title: b.name, subtitle: 'Recurring charge', cents: Math.abs(b.expected_amount_cents ?? 0) || null, merchant: b.name });
  }
  for (const l of loans) {
    const end = l.bt?.end_date;
    // A promo ending is worth seeing sooner: two months out.
    if (!end || !(end >= today && between(today, end) <= 60) || !(l.bt.balance_cents > 0)) continue;
    items.push({ key: `promo:${l.id}`, date: end, title: `${l.name}: 0% ends`, subtitle: `${formatMoney(l.bt.balance_cents)} left on it`, cents: null, account_id: l.linked_account_id ?? null });
  }
  const groups = new Map();
  for (const it of items.sort((a, b) => a.date.localeCompare(b.date))) {
    if (!groups.has(it.date)) {
      const n = between(today, it.date);
      groups.set(it.date, { date: it.date, label: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : day(it.date), items: [] });
    }
    groups.get(it.date).items.push(it);
  }
  return [...groups.values()];
}

/**
 * Cleared alerts by month, newest month first, newest first within.
 * @returns [{ month, label, items: [{ key, title, resolved_at }] }]
 */
export function clearedByMonth(rows = []) {
  const months = new Map();
  for (const r of rows.filter((x) => x.resolved_at).sort((a, b) => String(b.resolved_at).localeCompare(String(a.resolved_at)))) {
    const m = String(r.resolved_at).slice(0, 7);
    if (!months.has(m)) months.set(m, { month: m, label: monthLong(m), items: [] });
    months.get(m).items.push({ key: r.id, title: clearedTitle(r), resolved_at: r.resolved_at, type: r.type });
  }
  return [...months.values()];
}

/** What a cleared alert means, in a few words: "Paid · Robinhood Gold ···5112", "Uploaded · …". */
export function clearedTitle(r) {
  const t = String(r.title ?? '');
  switch (r.type) {
    case 'OVERDUE_STATEMENT': return `Uploaded · ${t.replace(/ statement$/, '')}`;
    case 'CARD_PAYMENT_DUE': return `Paid · ${t.replace(/ payment$/, '')}`;
    case 'CARD_TERMS_CHANGED': return `Seen · ${t}`;
    case 'TERMS_NOTICE': return `Took effect · ${t.replace(/ terms change \d{4}-\d{2}-\d{2}$/, '')}`;
    case 'CARD_HIGH_USE': return `Back under 30% · ${t.replace(/ at \d+% of its limit$/, '')}`;
    case 'CARD_SPEND_JUMP': return `Seen · ${t}`;
    case 'MISSED_RECURRING': return `Charged or stopped · ${t}`;
    case 'NEW_RECURRING': return `New bill handled · ${t}`;
    case 'PENDING_REVIEW': return `Reviewed · ${t.replace(/ — \d+ to review$/, '')}`;
    default: return t;
  }
}
