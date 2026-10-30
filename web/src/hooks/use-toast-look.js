import { invalidate } from './use-api';
import { useSetting } from './use-setting';
import { api } from '../api';
import { TOAST_LOOK_SETTING_KEY, lookChanged, lookFor } from '../lib/app/toast-look';

/**
 * Toasts' look and place for a design (D387), and a change to them. A
 * household setting, like the names; `ready` is false while it loads. A change
 * resolves once saved, and every other copy (the toasts') reloads then.
 */
export function useToastLook(design) {
  // Tagged, so a change in Settings reaches the toasts (always on screen, with their own copy) at once.
  const req = useSetting(TOAST_LOOK_SETTING_KEY, { tags: [TOAST_LOOK_SETTING_KEY] });
  const saved = req.data?.value ?? null;

  function change(update) {
    const next = lookChanged(saved, design, update);
    req.setData((d) => ({ ...d, value: next }));
    return api.appSetting.set(TOAST_LOOK_SETTING_KEY, next).then(() => invalidate(TOAST_LOOK_SETTING_KEY), () => req.reload());
  }

  return { ...lookFor(saved, design), ready: req.data !== undefined, change };
}
