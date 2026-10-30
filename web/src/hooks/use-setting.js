import { useCallback } from 'react';
import { useApi } from './use-api';
import { api } from '../api';

/**
 * One household setting (app_setting), read from a single request for all
 * of them (D389): the five setting hooks used to make one request each on
 * every page. Same shape the per-key route gave, so callers don't change:
 * `data` is { key, value } once loaded (value null when never saved), and
 * `setData` edits it optimistically, here and in every other view.
 */
export function useSetting(key, { tags = [] } = {}) {
  const req = useApi('settings', () => api.appSetting.all(), { tags: ['settings', ...tags] });
  const all = req.data;
  const { setData: setAll, reload } = req;
  const setData = useCallback((next) => setAll((current) => {
    const before = { key, value: current?.[key] ?? null };
    const after = typeof next === 'function' ? next(before) : next;
    return { ...current, [key]: after?.value ?? null };
  }), [key, setAll]);
  return {
    data: all === undefined ? undefined : { key, value: all[key] ?? null },
    error: req.error,
    reload,
    setData,
  };
}
