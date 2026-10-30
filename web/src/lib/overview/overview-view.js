/**
 * Which month and span Overview shows (D380). The address holds it
 * (`/overview?month=2026-09&span=ytd`), so a refresh or a shared link keeps it;
 * without one, the last pick in this tab, then this month. A month after this
 * one isn't on the picker, so it falls back to this month.
 */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SPANS = ['month', 'ytd'];

export function overviewView(params, saved, thisMonth) {
  const pick = (key, ok) => [params.get(key), saved?.[key]].find(ok);
  const month = pick('month', (m) => MONTH.test(m ?? '') && m <= thisMonth) ?? thisMonth;
  const span = pick('span', (s) => SPANS.includes(s)) ?? 'month';
  return { month, span };
}

/** The address for a view: this month and Month leave the address bare. */
export function viewParams({ month, span }, thisMonth) {
  const out = {};
  if (month !== thisMonth) out.month = month;
  if (span !== 'month') out.span = span;
  return out;
}
