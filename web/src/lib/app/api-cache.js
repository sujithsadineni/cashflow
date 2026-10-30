/**
 * The answers useApi keeps, shared by key (D389). No React here, so it can
 * be tested alone; hooks/use-api.js subscribes to it.
 *
 * - keep(key, data, tags): the answer for a key, with the tags it reloads on.
 * - load(key, fetcher, tags, force): make the request, unless one for the key
 *   is already running (share it) or was answered in the last FRESH_MS. A
 *   forced request (a reload, a tag, a save) only shares one started in the
 *   same task, never one started before the save, and a reply that arrives
 *   after a newer request for the key was made is dropped.
 * - forget(tags): drop kept answers with any of these tags.
 */

export const FRESH_MS = 2000;
export const MAX_KEPT = 300;

export function createApiCache({ now = () => Date.now(), fresh = FRESH_MS, max = MAX_KEPT, nextTask = queueMicrotask } = {}) {
  const kept = new Map(); // key → { data, at, tags }, a new object on every change
  const inflight = new Map(); // key → { promise, gen, token }
  const listeners = new Set();
  let gen = 0;
  let token = null;

  // Requests started by the same commit's effects share a token.
  function currentToken() {
    if (!token) { token = {}; nextTask(() => { token = null; }); }
    return token;
  }
  const notify = () => listeners.forEach((fn) => fn());

  function keep(key, data, tags = []) {
    const before = kept.get(key);
    kept.delete(key); // re-inserted last: the Map's order is least recently kept first
    kept.set(key, { data, at: now(), tags: new Set([...(before?.tags ?? []), ...tags]) });
    while (kept.size > max) kept.delete(kept.keys().next().value);
    notify();
  }

  function load(key, fetcher, tags = [], force = false) {
    const running = inflight.get(key);
    const t = currentToken();
    if (running && (!force || running.token === t)) return running.promise;
    const entry = kept.get(key);
    if (!force && entry && now() - entry.at < fresh) return Promise.resolve();
    const mine = ++gen;
    const promise = Promise.resolve()
      .then(fetcher)
      .then((data) => { if (inflight.get(key)?.gen === mine) keep(key, data, tags); })
      .finally(() => { if (inflight.get(key)?.gen === mine) inflight.delete(key); });
    inflight.set(key, { promise, gen: mine, token: t });
    return promise;
  }

  function forget(tags) {
    let changed = false;
    for (const [key, entry] of kept) if (tags.some((t) => entry.tags.has(t))) { kept.delete(key); changed = true; }
    if (changed) notify();
  }

  return {
    get: (key) => kept.get(key),
    keep,
    load,
    forget,
    clear: () => { kept.clear(); inflight.clear(); notify(); },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
