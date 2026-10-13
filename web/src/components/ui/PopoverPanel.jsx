import { createPortal } from 'react-dom';

/**
 * The floating panel the Dropdown and the date pickers open (D230),
 * portalled to <body> so a table's overflow can't clip it and a click inside
 * can't re-trigger a wrapping <label>. On a phone it is a bottom sheet over
 * a scrim. `place` comes from usePlacement (use-popover.js).
 */
export function PopoverPanel({ place, panelRef, onKeyDown, style, className = '', children, ...rest }) {
  if (!place) return null;
  return createPortal(
    <>
      {place.sheet && <div className="fixed inset-0 z-[60] bg-ink/25" aria-hidden="true" />}
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        {...rest}
        className={`dropdown-panel fixed z-[61] flex flex-col border border-rule bg-raised p-1 text-sm text-ink shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3),0_2px_6px_-2px_rgb(0_0_0/0.12)] outline-none ${
          place.sheet ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl pb-[calc(0.5rem+env(safe-area-inset-bottom))]' : 'rounded-xl'} ${className}`}
        style={place.sheet ? undefined : { left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, ...style }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
