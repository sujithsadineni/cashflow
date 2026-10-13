/**
 * Placement and closing for the app's popovers (D229, D230): the Dropdown
 * and the date pickers. A popover opens under its trigger, or above it when
 * there's no room, follows the page as it scrolls, and is a bottom sheet
 * on a phone. A click outside the trigger and the panel closes it.
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * @param open - whether the panel is showing
 * @param triggerRef - the button it hangs from
 * @param minWidth - the panel's narrowest width in px (it never goes narrower than the trigger)
 * Returns [place, update]: call update() as it opens, from the click, so the
 * first frame is already in place.
 */
export function usePlacement(open, triggerRef, minWidth) {
  const [place, setPlace] = useState(null);
  const update = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    if (window.innerWidth < 640) { setPlace({ sheet: true }); return; }
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 32);
    const left = Math.min(Math.max(16, r.left), window.innerWidth - 16 - width);
    const below = window.innerHeight - r.bottom - 16;
    const up = below < 260 && r.top > below;
    setPlace({ left, width, minWidth: r.width, maxHeight: Math.max(160, (up ? r.top - 16 : below) - 8), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }, [triggerRef, minWidth]);
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open, update]);
  return [place, update];
}

/** Closes the popover on a pointer-down outside both refs. */
export function useOutsideClose(open, refs, close) {
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (refs.every((r) => !r.current?.contains(e.target))) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, refs, close]);
}
