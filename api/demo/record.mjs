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
 *   node api/demo/record.mjs   → web/public/demo/responses.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const API = process.env.DEMO_API ?? 'http://127.0.0.1:4100/api';
const WEB = process.env.DEMO_WEB ?? 'http://127.0.0.1:5180';
const CDP = process.env.DEMO_CDP ?? 'http://127.0.0.1:9333';
const OUT = new URL('../../web/public/demo/responses.json', import.meta.url).pathname;
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(2025, 9 + i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ---- 1. Use the app a little ------------------------------------------
const GLYPHS = { netflix: '🎬', spotify: '🎧', disney: '🏰', apple: '🍎', spectrum: '📶', duke: '💡', allstate: '🛡️', planet: '🏋️', bilt: '🏠', robinhood: '📈', wells: '🚗' };
const glyphFor = (name) => Object.entries(GLYPHS).find(([k]) => name.toLowerCase().includes(k))?.[1] ?? '🔁';
const candidates = await api('/recurring/detect', { method: 'POST' });
for (const c of candidates.slice(0, 10)) {
  await api('/recurring', {
    method: 'POST',
    body: JSON.stringify({
      name: c.suggested_name, glyph: glyphFor(c.suggested_name), match_name_contains: c.match_name_contains,
      match_amount_min_cents: c.match_amount_min_cents, match_amount_max_cents: c.match_amount_max_cents,
      match_days_of_month: c.match_days_of_month, cadence: c.cadence, cadence_interval: c.cadence_interval,
      expected_amount_cents: c.expected_amount_cents, amount_varies: c.amount_varies,
      next_expected_date: c.next_expected_date, confidence: c.confidence, created_from: 'DETECTED',
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
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
const clickAll = (selector, text) =>
  evaluate(`(async () => { for (const el of [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'})) { el.click(); await new Promise(r => setTimeout(r, 500)); } })()`);

const visit = async (path, then) => {
  await send('Page.navigate', { url: `${WEB}${path}` });
  await wait(2500);
  if (then) await then();
};
await visit('/');
await visit('/overview', () => clickAll('button', 'YTD'));
await visit('/cards', () => clickAll('button[aria-label^="Next"], button[aria-label*="next"]'));
await visit('/transactions');
await visit('/recurring', () => clickAll('button', 'Review detected'));
await visit('/activity');
await visit('/alerts');
await visit('/import');
const SETTINGS_TABS = ['Accounts', 'Loans', 'People', 'Categories', 'Merchant icons', 'Overview cards', 'Design', 'Privacy'];
await visit('/settings', () =>
  evaluate(`(async () => { for (const label of ${JSON.stringify(SETTINGS_TABS)}) { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)?.click(); await new Promise(r => setTimeout(r, 700)); } })()`));
ws.close();

// ---- 3. Every month-based endpoint, for every demo month -----------------
const monthKeys = Object.keys(responses).filter((k) => k.startsWith('GET ') && k.includes('month=2026-09'));
for (const key of monthKeys) {
  for (const month of MONTHS) {
    const k = key.replaceAll('2026-09', month);
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
for (const s of await api('/recurring?include_ended=true')) responses[`GET /recurring/${s.id}/transactions`] ??= await api(`/recurring/${s.id}/transactions`);

mkdirSync(new URL('.', `file://${OUT}`).pathname, { recursive: true });
writeFileSync(OUT, JSON.stringify(responses));
console.log(`record: ${Object.keys(responses).length} responses → ${OUT}`);
process.exit(0);
