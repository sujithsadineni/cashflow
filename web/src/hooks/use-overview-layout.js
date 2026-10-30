import { useSetting } from './use-setting';
import { api } from '../api';
import { OVERVIEW_LAYOUT_SETTING_KEY, layoutFrom } from '../lib/app/overview-cards';

/**
 * Overview's layout (D378) — Slim rows, Stats rail or Bento — and a setter.
 * `layout` is null while loading. A household setting, like the cards.
 */
export function useOverviewLayout() {
  const req = useSetting(OVERVIEW_LAYOUT_SETTING_KEY);
  const layout = req.data === undefined ? null : layoutFrom(req.data?.value ?? null);

  function setLayout(key) {
    const saved = { layout: key };
    req.setData((d) => ({ ...d, value: saved }));
    api.appSetting.set(OVERVIEW_LAYOUT_SETTING_KEY, saved).catch(() => req.reload());
  }

  return { layout, setLayout };
}
