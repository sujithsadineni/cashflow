/**
 * The GitHub Pages demo's stand-in for the API. `npm run build:demo`
 * sets VITE_DEMO=1, and request() in api.js hands every call here.
 *
 * public/demo/responses.json was recorded by api/demo/record.mjs from
 * the real API running against an invented household (api/demo/seed.mjs),
 * so every screen shows what the real app would, without a server.
 *
 * Reads replay the recorded response for the same method + path, or —
 * for a filter combination nobody recorded — the same endpoint's closest
 * recorded response (the most query values in common). The transaction
 * list and a card's category totals are worked out here from every
 * recorded row (D257), so search and filters answer like the real API.
 * Writes don't pretend to succeed: they fail with a plain "read-only
 * demo" message, the same way any rejected write already surfaces in the UI.
 */

let recorded;

function load() {
  recorded ??= fetch(`${import.meta.env.BASE_URL}demo/responses.json`).then((r) => r.json());
  return recorded;
}

/** The recorded key for a request: "GET /summary?month=2026-09". Exported for the test. */
export function keyFor(path, method = 'GET') {
  return `${method.toUpperCase()} ${path}`;
}

/** Every transaction, recorded once (api/demo/record.mjs), newest first. */
export const ALL_TRANSACTIONS = 'ALL /transactions';

const sumBy = (rows, sign) => rows.reduce((s, r) => s + (Math.sign(r.amount_cents) === sign ? r.amount_cents : 0), 0);

/** GET /transactions from every row: the same filters, totals and paging as routes/transactions.js. */
export function listTransactions(all, params) {
  const p = Object.fromEntries(params);
  const q = p.q?.trim().toLowerCase();
  const rows = all.filter((t) =>
    (!p.account_id || t.account_id === Number(p.account_id))
    && (!p.person_id || t.person_id === Number(p.person_id))
    && (!p.category_id || (p.category_id === 'none' ? t.category_id == null : t.category_id === Number(p.category_id)))
    && (!p.from || t.posted_date.slice(0, 10) >= p.from)
    && (!p.to || t.posted_date.slice(0, 10) <= p.to)
    && (!p.txn_type || t.txn_type === p.txn_type)
    && (!q || t.description?.toLowerCase().includes(q) || t.merchant?.toLowerCase().includes(q)));
  const months = {};
  for (const t of rows) {
    const m = (months[t.posted_date.slice(0, 7)] ??= { count: 0, out_cents: 0, in_cents: 0 });
    m.count += 1;
    if (t.amount_cents < 0) m.out_cents += t.amount_cents;
    if (t.amount_cents > 0) m.in_cents += t.amount_cents;
  }
  const limit = Math.min(Number(p.limit) || 50, 200);
  const offset = Number(p.offset) || 0;
  return { total: rows.length, out_cents: sumBy(rows, -1), in_cents: sumBy(rows, 1), months, limit, offset, rows: rows.slice(offset, offset + limit) };
}

/** GET /transactions/category-summary from every row: one card's categories, biggest first. */
export function categorySummary(all, params) {
  const p = Object.fromEntries(params);
  const by = new Map();
  for (const t of all) {
    const date = t.posted_date.slice(0, 10);
    if (t.account_id !== Number(p.account_id) || (p.from && date < p.from) || (p.to && date > p.to)) continue;
    const c = by.get(t.category_id) ?? { category_id: t.category_id, category_name: t.category_name, category_icon_key: t.category_icon_key, count: 0, in_cents: 0, out_cents: 0 };
    c.count += 1;
    if (t.amount_cents > 0) c.in_cents += t.amount_cents;
    else c.out_cents -= t.amount_cents;
    by.set(t.category_id, c);
  }
  const categories = [...by.values()].sort((a, b) => b.in_cents + b.out_cents - (a.in_cents + a.out_cents) || String(a.category_name).localeCompare(String(b.category_name)));
  const total = categories.reduce((s, c) => ({ count: s.count + c.count, in_cents: s.in_cents + c.in_cents, out_cents: s.out_cents + c.out_cents }), { count: 0, in_cents: 0, out_cents: 0 });
  return { total, categories };
}

/** Every Activity entry, recorded once per area chip (record.mjs): 'ALL /activity' and 'ALL /activity?area=…'. */
export const ALL_ACTIVITY = 'ALL /activity';

/** GET /activity from the recorded log: one area, one thing's own history (?entity=transaction:12), a page before an id. */
export function listActivity(responses, params) {
  const p = Object.fromEntries(params);
  const all = responses[p.area ? `${ALL_ACTIVITY}?area=${p.area}` : ALL_ACTIVITY] ?? [];
  const [type, id] = (p.entity ?? '').split(':');
  return all
    .filter((e) => (!p.entity || (e.entity_type === type && e.entity_id === Number(id))) && (!p.before || e.id < Number(p.before)))
    .slice(0, Math.min(Number(p.limit) || 50, 200));
}

/** The best recorded response for a key, or undefined. Pure, so it's testable. */
export function lookup(responses, key) {
  const [method, path] = key.split(' ');
  const [bare, search = ''] = path.split('?');
  const all = responses[ALL_TRANSACTIONS];
  if (method === 'GET' && all && bare === '/transactions') return listTransactions(all, new URLSearchParams(search));
  if (method === 'GET' && all && bare === '/transactions/category-summary') return categorySummary(all, new URLSearchParams(search));
  if (method === 'GET' && ALL_ACTIVITY in responses && bare === '/activity') return listActivity(responses, new URLSearchParams(search));
  if (key in responses) return responses[key];
  if (method !== 'GET') return undefined;
  if (`GET ${bare}` in responses) return responses[`GET ${bare}`];
  // The same endpoint with the most query values in common: a merchant's
  // history with an unrecorded category chip falls back to that merchant.
  const wanted = new URLSearchParams(search);
  const shared = (k) => [...new URLSearchParams(k.split('?')[1])].filter(([name, value]) => wanted.get(name) === value).length;
  const sameEndpoint = Object.keys(responses).filter((k) => k.startsWith(`GET ${bare}?`)).sort((a, b) => shared(b) - shared(a))[0];
  return sameEndpoint ? responses[sameEndpoint] : undefined;
}

export async function demoRequest(path, options = {}, notify = () => {}) {
  const responses = await load();
  const key = keyFor(path, options.method);
  const hit = lookup(responses, key);
  if (hit !== undefined) return structuredClone(hit);

  // Says which read the recording lacks, so a re-record can cover it.
  if (key.startsWith('GET ')) console.warn(`demo: not recorded — ${key}`);
  const error = new Error(
    key.startsWith('GET ') ? 'Not included in this demo' : "This is a read-only demo — changes aren't saved",
  );
  error.status = key.startsWith('GET ') ? 404 : 403;
  if (!key.startsWith('GET ')) notify(error.message);
  throw error;
}
