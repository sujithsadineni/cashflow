/**
 * Credit utilisation (D346): what a card owed on its statement against the
 * limit that statement printed, per card and for the household. A
 * comparison of two printed figures, never a projection. Pure; tested in
 * utilisation.test.js.
 */

/**
 * The tone of the bar: quiet under 30% (the share people usually aim to stay
 * under), amber from 30%, red from 70%. Red is for problems in this app.
 */
export const utilisationTone = (pct) => (pct >= 70 ? 'spend' : pct >= 30 ? 'warn' : 'muted');

/** One card: { used, limit, available, pct, tone, asOf }, or null when its statements print no limit. */
export function cardUtilisation(account) {
  const line = account?.credit_line;
  if (!line || line.credit_limit_cents == null || Number(line.credit_limit_cents) <= 0) return null;
  const limit = Number(line.credit_limit_cents);
  // A credit balance owes nothing.
  const used = Math.max(Number(line.closing_balance_cents ?? 0), 0);
  const pct = Math.round((100 * used) / limit);
  const manual = line.source === 'manual';
  const printed = line.available_credit_cents == null ? null : Number(line.available_credit_cents);
  return {
    used, limit, pct, tone: utilisationTone(pct), asOf: line.as_of,
    // Against a limit the household set, what's left of it (D357): an estimate, said as one, since
    // the bank printed no "available" for that limit.
    available: printed ?? (manual ? limit - used : null),
    availableEstimated: printed == null && manual,
    // A limit the household set (D354), not one a statement printed.
    manual,
  };
}

/**
 * The household: every open card with a limit, summed. `cards` counts them,
 * `without` names the open cards whose statements print none (Apple), so the
 * tile can say they're left out rather than quietly leave them out.
 */
export function householdUtilisation(accounts) {
  const open = accounts.filter((a) => a.account_type === 'CREDIT_CARD' && a.is_active !== false);
  const each = open.map((a) => [a, cardUtilisation(a)]);
  const counted = each.filter(([, u]) => u);
  if (counted.length === 0) return null;
  const used = counted.reduce((s, [, u]) => s + u.used, 0);
  const limit = counted.reduce((s, [, u]) => s + u.limit, 0);
  const pct = Math.round((100 * used) / limit);
  return { used, limit, pct, tone: utilisationTone(pct), cards: counted.length, without: each.filter(([, u]) => !u).map(([a]) => a.name) };
}

/** One statement's utilisation (D347): the limit and balance it printed. null when it printed no limit. */
export const statementUtilisation = (s) => (s ? cardUtilisation({ credit_line: {
  credit_limit_cents: s.credit_limit_cents, available_credit_cents: s.available_credit_cents,
  closing_balance_cents: s.closing_balance_cents, as_of: s.period_end,
} }) : null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * What the back of a card says about its limit (D347), from GET
 * …/statement-facts: the statement's own limit; else the last limit printed
 * before it, dated, when there is one (Zolve's 2026 layout stopped printing
 * it); else why there's none: the statement prints none (Apple), or it's a
 * locked PDF never opened. { u, note, lastPrinted }.
 */
export function backLimit(data) {
  const s = data?.statement;
  if (!s) return { u: null, note: null, lastPrinted: false };
  const own = statementUtilisation(s);
  if (own) return { u: own, note: null, lastPrinted: false };
  if (data.last_limit) {
    const u = cardUtilisation({ credit_line: { credit_limit_cents: data.last_limit.credit_limit_cents, available_credit_cents: null, closing_balance_cents: s.closing_balance_cents, as_of: data.last_limit.as_of } });
    // What's left of that limit, an estimate (D357): this statement printed no "available".
    if (u) Object.assign(u, { available: u.limit - u.used, availableEstimated: true });
    return { u, note: `of the limit last printed, ${monthYear(data.last_limit.as_of)}`, lastPrinted: true };
  }
  // A limit the household set (D354), when no statement has printed one.
  if (data.manual_limit_cents != null) {
    const u = cardUtilisation({ credit_line: { credit_limit_cents: data.manual_limit_cents, available_credit_cents: null, closing_balance_cents: s.closing_balance_cents, as_of: null, source: 'manual' } });
    return { u, note: 'of the limit you set', lastPrinted: true };
  }
  return {
    u: null, lastPrinted: false,
    note: data.limit_note === 'locked' ? 'locked PDF: open it once on Import with its password' : 'this statement prints no limit',
  };
}

/** "28.74%" from basis points; null when not printed. */
export const aprText = (bps) => (bps == null ? null : `${(Number(bps) / 100).toFixed(2)}%`);

/** The statement's other rates in words, for the APR cell's title (D349): "Cash advances 29.49% · Penalty 29.99%". */
export function otherAprs(s) {
  if (!s) return '';
  return [
    ['Balance transfers', s.apr_balance_transfer_bps], ['Cash advances', s.apr_cash_advance_bps], ['Penalty', s.apr_penalty_bps],
  ].filter(([, b]) => b != null).map(([label, b]) => `${label} ${aprText(b)}`).join(' · ');
}

/**
 * What the statement says it earned (D351), one line for the back of the card:
 * miles in miles ("1,966 miles sent to Frontier Airlines"), cash back with
 * what's available ("Earned $6.33 · $6.33 available"; a negative month "Gave
 * back $0.03"), or, where a card prints only a balance (Amex), what's waiting.
 * `money` formats cents. null when the statement printed none of it.
 */
export function earnedLine(s, money) {
  if (!s) return null;
  const r = s.rewards ?? {};
  if (r.miles != null) return `${Number(r.miles).toLocaleString('en-US')} miles sent to ${r.miles_to}`;
  const available = r.available_cents ?? s.cashback_balance_cents;
  if (s.cashback_earned_cents != null) {
    const earned = Number(s.cashback_earned_cents);
    const words = earned < 0 ? `Gave back ${money(-earned)} cash back` : `Earned ${money(earned)} cash back`;
    return available != null ? `${words} · ${money(Number(available))} available` : words;
  }
  return available != null ? `${money(Number(available))} in rewards waiting` : null;
}

/**
 * Credit used month by month (D358), from GET /api/summary/credit: each month
 * the household's share (householdUtilisation over its cards), null for a month
 * still to come or with no limit known yet.
 */
export function creditMonths(data) {
  return (data?.months ?? []).map((m, i) => ({
    month: m.month,
    household: i < (data.through_month ?? 12) ? householdUtilisation(m.cards) : null,
    cards: m.cards,
  }));
}
