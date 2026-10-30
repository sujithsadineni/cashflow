import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createApiCache } from '../lib/app/api-cache';

/**
 * One way for a component to load data (D211). Every page used to write
 * its own useEffect → fetch → setData/setError/setLoading, each a little
 * different, with no way for one page's edit to refresh another's view.
 *
 *   const { data, error, loading, reload, setData } =
 *     useApi(`summary:${accountId}:${month}`, () => api.transactions.categorySummary(...), { tags: ['transactions'] });
 *
 * - `key` names the request. When it changes, the new request is made;
 *   the previous data stays on screen until the new data arrives, so a
 *   table doesn't blank between pages. `loading` is true until data for
 *   *this* key is in. A null key means "nothing to load yet".
 * - `reload()` makes the same request again; `setData` edits what's
 *   shown (an optimistic recategorise) without another request.
 * - `tags` subscribe to `invalidate(tag)`: approving an import calls
 *   `invalidate('transactions')` and every open view of transactions
 *   reloads.
 * - `refresh`: any value; when it changes the request is made again (the
 *   sidebar badges pass the page's path, to recount on every page change).
 *
 * Shared by key (D389, lib/app/api-cache.js). A key names one request, so
 * every view with that key shows the same data, and views asking at the
 * same time share one request. The last answer is kept: a page opened
 * again shows it at once and asks again in the background. invalidate(tag)
 * also forgets kept answers with that tag, so a page opened after a save
 * waits for fresh data rather than showing the old.
 *
 * Why not TanStack Query: the app keeps dependencies few on purpose, and
 * this is all these pages need.
 */

const cache = createApiCache();

// --- invalidation: a version per tag, bumped by invalidate() ---
// A fresh Map on every change, so useSyncExternalStore sees a new value.
let versions = new Map();
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getVersions = () => versions;

/** Reload every mounted useApi that subscribed to any of these tags, and forget kept answers with them. */
export function invalidate(...tags) {
  cache.forget(tags);
  const next = new Map(versions);
  for (const t of tags) next.set(t, (next.get(t) ?? 0) + 1);
  versions = next;
  listeners.forEach((fn) => fn());
}

export function useApi(key, fetcher, { tags = [], refresh } = {}) {
  const [shown, setShown] = useState({ key: undefined, data: undefined, error: null });
  const [tick, setTick] = useState(0);
  const all = useSyncExternalStore(subscribe, getVersions, getVersions);
  const tagVersion = tags.map((t) => all.get(t) ?? 0).join(',');
  const readKept = () => (key == null ? undefined : cache.get(key));
  const entry = useSyncExternalStore(cache.subscribe, readKept, readKept);

  // A kept answer for this key (this view's request, or another view's) is shown at once.
  if (entry && (shown.key !== key || shown.data !== entry.data)) setShown({ key, data: entry.data, error: null });

  // The latest fetcher, tags and data, read when a request or an edit is
  // made (the fetcher closes over values the key already names, so it's
  // safe to not depend on it).
  const latest = useRef({ fetcher, tags, data: shown.data });
  useEffect(() => { latest.current = { fetcher, tags, data: shown.data }; });

  // What the last request was for: the same key with a new tick, tag
  // version or refresh value is a forced request.
  const last = useRef(null);

  useEffect(() => {
    if (key == null) return undefined;
    const before = last.current;
    const force = before != null && before.key === key && (before.tick !== tick || before.tagVersion !== tagVersion || before.refresh !== refresh);
    last.current = { key, tick, tagVersion, refresh };
    let live = true;
    cache.load(key, () => latest.current.fetcher(), latest.current.tags, force)
      .catch((err) => live && setShown((s) => ({ ...s, key, error: err?.message ?? String(err) })));
    return () => { live = false; };
  }, [key, tick, tagVersion, refresh]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setData = useCallback((next) => {
    if (key == null) return;
    // Kept straight away, so every view with this key (this one too) shows the edit.
    const current = cache.get(key)?.data ?? latest.current.data;
    cache.keep(key, typeof next === 'function' ? next(current) : next, latest.current.tags);
  }, [key]);

  return {
    data: shown.data,
    error: shown.key === key ? shown.error : null,
    loading: key != null && !entry && shown.key !== key,
    reload,
    setData,
  };
}
