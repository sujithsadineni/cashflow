/**
 * The GitHub Pages demo's stand-in for the API. `npm run build:demo`
 * sets VITE_DEMO=1, and request() in api.js hands every call here.
 *
 * public/demo/responses.json was recorded by api/demo/record.mjs from
 * the real API running against an invented household (api/demo/seed.mjs),
 * so every screen shows what the real app would, without a server.
 *
 * Reads replay the recorded response for the same method + path, or —
 * for a filter combination nobody recorded — the same endpoint's
 * unfiltered response. Writes don't pretend to succeed: they fail with
 * a plain "read-only demo" message, the same way any rejected write
 * already surfaces in the UI.
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

/** The best recorded response for a key, or undefined. Pure, so it's testable. */
export function lookup(responses, key) {
  if (key in responses) return responses[key];
  const [method, path] = key.split(' ');
  if (method !== 'GET') return undefined;
  const bare = path.split('?')[0];
  if (`GET ${bare}` in responses) return responses[`GET ${bare}`];
  const sameEndpoint = Object.keys(responses).find((k) => k.startsWith(`GET ${bare}?`));
  return sameEndpoint ? responses[sameEndpoint] : undefined;
}

export async function demoRequest(path, options = {}, notify = () => {}) {
  const responses = await load();
  const key = keyFor(path, options.method);
  const hit = lookup(responses, key);
  if (hit !== undefined) return structuredClone(hit);

  const error = new Error(
    key.startsWith('GET ') ? 'Not included in this demo' : "This is a read-only demo — changes aren't saved",
  );
  error.status = key.startsWith('GET ') ? 404 : 403;
  if (!key.startsWith('GET ')) notify(error.message);
  throw error;
}
