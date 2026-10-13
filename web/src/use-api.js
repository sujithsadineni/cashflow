import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

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
 * - A response that arrives after the component moved on (another key,
 *   or unmounted) is dropped, so a slow old request can't overwrite a
 *   newer one.
 *
 * Why not TanStack Query: the app keeps dependencies few on purpose, and
 * this is all these pages need. No shared cache across components; each
 * view loads its own.
 */

// --- invalidation: a version per tag, bumped by invalidate() ---
// A fresh Map on every change, so useSyncExternalStore sees a new value.
let versions = new Map();
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getVersions = () => versions;

/** Reload every mounted useApi that subscribed to any of these tags. */
export function invalidate(...tags) {
  const next = new Map(versions);
  for (const t of tags) next.set(t, (next.get(t) ?? 0) + 1);
  versions = next;
  listeners.forEach((fn) => fn());
}

export function useApi(key, fetcher, { tags = [] } = {}) {
  const [state, setState] = useState({ key: undefined, data: undefined, error: null });
  const [tick, setTick] = useState(0);
  const all = useSyncExternalStore(subscribe, getVersions, getVersions);
  const tagVersion = tags.map((t) => all.get(t) ?? 0).join(',');

  // The latest fetcher, read when the request is made (it closes over
  // values the key already names, so it's safe to not depend on it).
  const latest = useRef(fetcher);
  useEffect(() => { latest.current = fetcher; });

  useEffect(() => {
    if (key == null) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => latest.current())
      .then(
        (data) => live && setState({ key, data, error: null }),
        (err) => live && setState((s) => ({ ...s, key, error: err?.message ?? String(err) })),
      );
    return () => { live = false; };
  }, [key, tick, tagVersion]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setData = useCallback((next) => setState((s) => ({ ...s, data: typeof next === 'function' ? next(s.data) : next })), []);

  return {
    data: state.data,
    error: state.key === key ? state.error : null,
    loading: key != null && state.key !== key,
    reload,
    setData,
  };
}
