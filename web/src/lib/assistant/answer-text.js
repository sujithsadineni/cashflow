/**
 * An "Answer here" result in words (D332 step 3). The API sends facts in
 * cents; this turns them into the sentences the panel shows. `money` is
 * formatMoney, passed in so this stays pure (and Privacy mode masks it).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

export const whatOf = (subjects) => (subjects.length ? subjects.map((s) => s.name).join(' + ') : 'All spending');

function describeSubject(s) {
  if (s.kind === 'category') return `category ${s.name}`;
  if (s.kind === 'account') return `card ${s.name}`;
  return `merchant ${s.name}`;
}

const TOP_TITLE = { merchants: 'Top merchants', purchases: 'Biggest purchases', categories: 'Top categories' };

/** { headline, lines, how, notes } for a result with `understood` not false. */
export function describeAnswer(d, money) {
  const what = whatOf(d.subjects);
  const [a, b] = d.periods;
  const lines = [];
  let headline;

  // A period with nothing in it that runs past the newest saved day isn't "down 100%": its statements aren't in yet.
  const latest = (d.notes ?? []).find((n) => n.kind === 'after_latest')?.latest;
  const notIn = (p) => latest && p.to > latest && p.count === 0 && p.back_cents === 0;

  if (d.intent === 'compare') {
    headline = `${what}: ${money(a.net_cents)} in ${a.label}, ${money(b.net_cents)} in ${b.label}`;
    const diff = a.net_cents - b.net_cents;
    const empty = [a, b].find(notIn);
    if (empty) lines.push(`Nothing saved for ${empty.label} yet, so there's nothing to compare.`);
    else if (diff === 0) lines.push('The same in both.');
    else if (b.net_cents > 0) lines.push(`${diff > 0 ? 'Up' : 'Down'} ${money(Math.abs(diff))} (${Math.round((Math.abs(diff) / b.net_cents) * 100)}%).`);
    else lines.push(`${diff > 0 ? 'Up' : 'Down'} ${money(Math.abs(diff))}.`);
  } else if (d.intent === 'top') {
    headline = `${TOP_TITLE[d.top.of]}${d.subjects.length ? ` for ${what}` : ''}, ${a.label}`;
    if (d.top.items.length === 0) lines.push('Nothing spent in that time.');
  } else {
    headline = a.count === 0 && a.back_cents === 0 ? `${what}, ${a.label}: nothing spent` : `${what}, ${a.label}: ${money(a.net_cents)}`;
  }

  if (d.intent === 'total' || d.intent === 'by_month') {
    if (a.back_cents > 0) lines.push(`Paid ${money(a.paid_cents)}, got back ${money(a.back_cents)} in ${plural(a.back_count, 'refund')}.`);
    if (a.count > 0) lines.push(`${plural(a.count, 'payment')}.`);
  }
  if (d.intent === 'by_month' && d.months?.length) {
    const n = d.months.length;
    if (n > 1) lines.push(`About ${money(Math.round(a.net_cents / n))} a month over ${plural(n, 'month')}.`);
    const most = d.months.reduce((m, x) => (x.net_cents > m.net_cents ? x : m), d.months[0]);
    if (most.net_cents > 0 && n > 1) lines.push(`Most in ${monthLabel(most.month)}: ${money(most.net_cents)}.`);
  }

  const how = `Counted: ${d.subjects.length ? d.subjects.map(describeSubject).join(', ') : 'all spending'}; money out less refunds. Card payments, transfers and savings aren't spending.`;
  const notes = (d.notes ?? []).map((n) => {
    if (n.kind === 'after_latest') return `Nothing is saved after ${shortDate(n.latest)}: statements since then aren't in yet.`;
    if (n.kind === 'also') return `“${n.word}” could also mean ${n.options.join(', ')}.`;
    return null;
  }).filter(Boolean);

  return { headline, lines, how, notes };
}

/**
 * What an Ask Claude answer cost, in words: "under 1¢", "about 3¢", "about
 * 12¢". The API keeps it in millionths of a dollar (an integer); 10,000 of
 * those make a cent.
 */
export function costLabel(microdollars) {
  if (microdollars == null) return null;
  const cents = Math.round(microdollars / 10_000);
  return cents < 1 ? 'under 1¢' : `about ${cents}¢`;
}

/** One lookup Ask Claude made, in words. */
export function describeLookup(l) {
  if (l.tool === 'find_names') return `Looked for names with “${l.input.text}”`;
  if (l.tool === 'search_transactions') return `Searched rows for “${l.input.text}”, ${l.input.from} to ${l.input.to}: ${l.count ?? 0} found`;
  const what = l.input.subjects.length ? l.input.subjects.map((s) => s.name).join(' + ') : 'all spending';
  const when = l.result ? l.result.periods.map((p) => p.label).join(' vs ') : l.input.periods.map((p) => `${p.from} to ${p.to}`).join(' vs ');
  return `Spending: ${what}, ${when}${l.error ? ` (${l.error})` : ''}`;
}
