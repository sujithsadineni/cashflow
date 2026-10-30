import { useSetting } from './use-setting';
import { api } from '../api';
import { OVERVIEW_CARDS_SETTING_KEY, toggledSetting, visibleCards } from '../lib/app/overview-cards';

/**
 * Which Overview cards are switched on, and a toggle. Shared by Overview and
 * the Classic, Vivid and Glass Settings panes. `visible` is null while
 * loading. Saved as the cards switched off, so a new card starts on (D311).
 */
export function useOverviewCards() {
  const req = useSetting(OVERVIEW_CARDS_SETTING_KEY);
  const visible = req.data === undefined ? null : visibleCards(req.data?.value ?? null);

  function toggle(key) {
    const { visible: next, saved } = toggledSetting(visible, key);
    // Optimistic: a preference, not money; no need to wait on the round trip.
    req.setData((d) => ({ ...d, value: saved }));
    api.appSetting.set(OVERVIEW_CARDS_SETTING_KEY, saved).catch(() => req.reload());
    return next;
  }

  return { visible, toggle };
}
