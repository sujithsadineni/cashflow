import { useEffect, useState } from 'react';
import { api } from './api';
import { OVERVIEW_CARDS, OVERVIEW_CARDS_SETTING_KEY } from './overview-cards';

/**
 * Which Overview cards are switched on, and a toggle. Shared by the Classic,
 * Vivid and Glass Settings panes. `visible` is null while loading. Unset
 * means every card on, so this is opt-out (see overview-cards.js).
 */
export function useOverviewCards() {
  const [visible, setVisible] = useState(null);

  useEffect(() => {
    api.appSetting.get(OVERVIEW_CARDS_SETTING_KEY).then((r) => {
      setVisible(r.value ?? OVERVIEW_CARDS.map((c) => c.key));
    });
  }, []);

  function toggle(key) {
    const next = visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key];
    setVisible(next); // optimistic — this is a preference, not money; no need to wait on the round trip
    api.appSetting.set(OVERVIEW_CARDS_SETTING_KEY, next);
  }

  return { visible, toggle };
}
