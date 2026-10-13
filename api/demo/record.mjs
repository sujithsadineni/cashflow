/**
 * Records the API responses the GitHub Pages demo replays (web/src/demo.js).
 *
 * Needs three things running (see docs in the README's "Demo" section):
 *   - the API on DEMO_API against a freshly seeded demo database (seed.mjs)
 *   - a Vite dev server on DEMO_WEB whose proxy points at that API
 *     (API_URL=http://127.0.0.1:4100 npx vite --port 5180)
 *   - Chrome with remote debugging on DEMO_CDP
 *
 * It first uses the app the way a person would, so every page has
 * something in it: accepts most detected recurring bills and makes a few
 * edits (the Activity page's "from → to" history). Then it opens every
 * page in the browser, saves each API response the UI asks for, and
 * fetches each month-based endpoint for all twelve demo months.
 *
 * D257: the browser opens in the Glass design (the demo's default) at
 * desktop and phone width, with its clock on DEMO_TODAY like the API's
 * (rebuild.sh). Every transaction is saved once, so the demo can search
 * and filter them itself, and every merchant's history is saved.
 *
 *   node api/demo/record.mjs   → web/public/demo/responses.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEMO_TODAY, pinClock } from '../../web/src/demo-clock.js';

const API = process.env.DEMO_API ?? 'http://127.0.0.1:4100/api';
const WEB = process.env.DEMO_WEB ?? 'http://127.0.0.1:5180';
const CDP = process.env.DEMO_CDP ?? 'http://127.0.0.1:9333';
const OUT = new URL('../../web/public/demo/responses.json', import.meta.url).pathname;
const LAST_MONTH = DEMO_TODAY.slice(0, 7);
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Number(LAST_MONTH.slice(0, 4)), Number(LAST_MONTH.slice(5)) - 12 + i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Postgres stamps rows with the real now(), not the demo's day, so the
 * edits made here would read as happening after "today". This moves every
 * timestamp in the demo database that's past DEMO_TODAY back by whole days,
 * onto it. Only ever the throwaway demo database (rebuild.sh's DEMO_DB).
 */
const DEMO_DB = process.env.DEMO_DB;
function backdate() {
  if (!DEMO_DB?.endsWith('/cashflow_demo')) throw new Error('DEMO_DB must be the cashflow_demo database');
  execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', DEMO_DB, '-c', `
    DO $$ DECLARE c record; BEGIN
      FOR c IN SELECT table_name, column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND data_type LIKE 'timestamp%' LOOP
        EXECUTE format('UPDATE %I SET %I = %I - (current_date - DATE ''${DEMO_TODAY}'') * interval ''1 day'' WHERE %I >= DATE ''${DEMO_TODAY}'' + 1',
                       c.table_name, c.column_name, c.column_name, c.column_name);
      END LOOP;
    END $$;`]);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ---- 1. Use the app a little ------------------------------------------
// Most of the detected bills added, the way Recurring's "Add" does it (D185);
// the rest stay as suggestions.
const suggestions = await api('/recurring/suggestions');
for (const sg of suggestions.slice(0, 10)) {
  await api('/recurring', {
    method: 'POST',
    body: JSON.stringify({
      name: sg.name, merchant: sg.merchant, cadence: sg.cadence, day: sg.day,
      expected_amount_cents: sg.expected_amount_cents, amount_varies: sg.amount_varies,
      match_amount_min_cents: sg.match_amount_min_cents, match_amount_max_cents: sg.match_amount_max_cents,
      charge_ids: sg.charges.map((c) => c.id),
    }),
  });
}
const categories = await api('/categories');
const catId = (name) => categories.find((c) => c.name === name).id;
const { rows: transactions } = await api("/transactions?limit=200");
const edit = async (match, changes) => {
  const t = transactions.find(match);
  if (t) await api(`/transactions/${t.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
};
await edit((t) => t.merchant === 'Costco', { category_id: catId('Groceries') });
await edit((t) => t.merchant === 'Uber', { category_id: catId('Travel') });
await edit((t) => t.merchant === 'Spice Corner', { merchant: 'Spice Corner Kitchen' });
// Review's checks, so its To fix tab has something to show.
await api('/transaction-review/run', { method: 'POST' });
backdate();

// ---- 2. Browse every page, capturing API responses ----------------------
const responses = {};
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const requests = new Map(); // requestId -> key
ws.addEventListener('message', async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
  if (m.method === 'Network.requestWillBeSent') {
    const url = new URL(m.params.request.url);
    if (url.pathname.startsWith('/api/')) requests.set(m.params.requestId, `${m.params.request.method} ${url.pathname.slice(4)}${url.search}`);
  }
  if (m.method === 'Network.loadingFinished' && requests.has(m.params.requestId)) {
    const key = requests.get(m.params.requestId);
    const body = await send('Network.getResponseBody', { requestId: m.params.requestId });
    try {
      if (body?.body) responses[key] = JSON.parse(body.body);
    } catch {
      // not JSON (an image) — the demo has none, skip
    }
  }
});
await send('Network.enable');
await send('Page.enable');
// Before any page script: the demo's clock, and Glass unless a design was picked.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(${pinClock})(${JSON.stringify(DEMO_TODAY)}); try { localStorage.getItem('cashflow_design') || localStorage.setItem('cashflow_design', 'glass'); } catch {}`,
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
const clickAll = (selector, text) =>
  evaluate(`(async () => { for (const el of [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'})) { el.click(); await new Promise(r => setTimeout(r, 500)); } })()`);

const visit = async (path, then) => {
  await send('Page.navigate', { url: `${WEB}${path}` });
  await wait(2500);
  if (then) await then();
};
for (const [width, height, mobile] of [[1400, 1000, false], [390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await visit('/');
  await visit('/overview', () => clickAll('button', 'YTD'));
  await visit('/cards', () => clickAll('button[aria-label^="Next"], button[aria-label*="next"]'));
  await visit('/transactions');
  for (const tab of ['findings', 'statements', 'payments', 'merchants']) await visit(`/review?tab=${tab}`);
  await visit('/recurring', () => clickAll('button', 'Review detected'));
  await visit('/activity');
  await visit('/alerts');
  await visit('/import');
  for (const tab of ['accounts', 'loans', 'people', 'categories', 'icons', 'overview', 'design', 'privacy', 'backups']) await visit(`/settings?tab=${tab}`);
}
ws.close();

// Alerts the pages saved while browsing, onto the demo's day too; then their history again.
backdate();
for (const key of Object.keys(responses)) if (key.startsWith('GET /alerts/history')) responses[key] = await api(key.slice(4));

// ---- 3. Every month-based endpoint, for every demo month -----------------
const monthKeys = Object.keys(responses).filter((k) => k.startsWith('GET ') && k.includes(`month=${LAST_MONTH}`));
for (const key of monthKeys) {
  for (const month of MONTHS) {
    const k = key.replaceAll(LAST_MONTH, month);
    if (!(k in responses)) responses[k] = await api(k.slice(4));
  }
}
// The Activity chart's Weeks / Years toggles, for every month.
for (const granularity of ['week', 'year']) {
  for (const month of MONTHS) {
    const path = `/transactions/trends?granularity=${granularity}&month=${month}`;
    responses[`GET ${path}`] ??= await api(path);
  }
}
// Every account's Cards-page view, not just the ones the carousel reached.
const accounts = await api('/accounts');
for (const a of accounts) {
  for (const path of [`/accounts/${a.id}/summary`, `/accounts/${a.id}/statement-months`, `/transactions?account_id=${a.id}&limit=25&offset=0`]) {
    responses[`GET ${path}`] ??= await api(path);
  }
}
// Each loan's month-by-month drill-down, and the Loans list for every month.
for (const l of await api('/loans')) responses[`GET /loans/${l.id}/history`] ??= await api(`/loans/${l.id}/history`);
for (const month of MONTHS) responses[`GET /loans?month=${month}`] ??= await api(`/loans?month=${month}`);
for (const s of await api('/recurring?include_ended=true')) responses[`GET /recurring/${s.id}/charges`] ??= await api(`/recurring/${s.id}/charges`);
// Every transaction once: web/src/demo.js filters, searches and pages these itself.
const all = [];
for (let offset = 0; ; offset += 200) {
  const page = await api(`/transactions?limit=200&offset=${offset}`);
  all.push(...page.rows);
  if (all.length >= page.total || page.rows.length === 0) break;
}
responses['ALL /transactions'] = all;
for (const key of Object.keys(responses)) if (/^GET \/transactions(\/category-summary)?\?/.test(key)) delete responses[key];
// Each merchant's history, whole and by each of its categories.
for (const merchant of [...new Set(all.map((t) => t.merchant).filter(Boolean))]) {
  const path = `/transactions/merchant-summary?merchant=${encodeURIComponent(merchant)}`;
  const summary = (responses[`GET ${path}`] ??= await api(path));
  for (const c of summary.by_category ?? []) {
    const k = `${path}&category_id=${c.category_id ?? 'none'}`;
    responses[`GET ${k}`] ??= await api(k);
  }
}
// The whole Activity log, once per area chip: web/src/demo.js pages it and
// picks out one row's own history (a transaction's History card) itself.
for (const area of [null, 'transactions', 'imports', 'recurring', 'setup']) {
  const log = [];
  for (let before = null; ;) {
    const page = await api(`/activity?${new URLSearchParams({ limit: 200, ...(area && { area }), ...(before && { before }) })}`);
    log.push(...page);
    if (page.length < 200) break;
    before = page.at(-1).id;
  }
  responses[area ? `ALL /activity?area=${area}` : 'ALL /activity'] = log;
}
for (const key of Object.keys(responses)) if (key.startsWith('GET /activity?')) delete responses[key];

mkdirSync(new URL('.', `file://${OUT}`).pathname, { recursive: true });
writeFileSync(OUT, JSON.stringify(responses));
console.log(`record: ${Object.keys(responses).length} responses → ${OUT}`);
process.exit(0);
