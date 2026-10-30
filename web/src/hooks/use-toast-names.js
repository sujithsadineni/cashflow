import { invalidate } from './use-api';
import { useSetting } from './use-setting';
import { api } from '../api';
import { TOAST_NAMES_SETTING_KEY, renamedToasts } from '../lib/app/toast-names';

/**
 * The household's toast renames (D384), kept per design (D386), and a rename
 * in a design. `saved` is null while loading. A rename returns what was saved
 * before, so it can be undone.
 */
export function useToastNames() {
  // Tagged, so a rename reaches the toasts (always on screen, with their own copy) at once.
  const req = useSetting(TOAST_NAMES_SETTING_KEY, { tags: [TOAST_NAMES_SETTING_KEY] });
  const saved = req.data === undefined ? null : req.data?.value ?? {};

  function rename(key, name, design) {
    const before = saved ?? {};
    const next = renamedToasts(before, key, name, design);
    req.setData((d) => ({ ...d, value: next }));
    api.appSetting.set(TOAST_NAMES_SETTING_KEY, next).then(() => invalidate(TOAST_NAMES_SETTING_KEY), () => req.reload());
    return before;
  }
  function restore(names) {
    req.setData((d) => ({ ...d, value: names }));
    api.appSetting.set(TOAST_NAMES_SETTING_KEY, names).then(() => invalidate(TOAST_NAMES_SETTING_KEY), () => req.reload());
  }

  return { saved, rename, restore };
}
