import { useSetting } from './use-setting';
import { api } from '../api';
import { OVERVIEW_SECTIONS_SETTING_KEY, shownSections, toggledSections } from '../lib/app/overview-cards';

/**
 * Which Overview sections under "Where it's going" are switched on (D375),
 * and a toggle. `shown` is null while loading. Off unless switched on.
 */
export function useOverviewSections() {
  const req = useSetting(OVERVIEW_SECTIONS_SETTING_KEY);
  const shown = req.data === undefined ? null : shownSections(req.data?.value ?? null);

  function toggle(key) {
    const { shown: next, saved } = toggledSections(shown, key);
    req.setData((d) => ({ ...d, value: saved }));
    api.appSetting.set(OVERVIEW_SECTIONS_SETTING_KEY, saved).catch(() => req.reload());
    return next;
  }

  return { shown, toggle };
}
