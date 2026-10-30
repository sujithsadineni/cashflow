import { useCallback, useId, useRef, useState } from 'react';
import { usePlacement, useOutsideClose } from '../../../hooks/use-popover';
import { PopoverPanel } from '../../ui/PopoverPanel';

/**
 * A name typed or picked (D297): a text field that suggests what's already
 * on file, one spelling each, so "Bank of America" is picked rather than
 * typed a third way. It still takes a new one. Accounts' issuer, Loans'
 * lender. `label` names the suggestions for assistive tech.
 *
 * Not a <datalist>: its popup is the browser's own and looks it. The
 * suggestions hang under the field in the app's popover, from its right
 * edge, on a phone too: a bottom sheet would cover the field being typed in. Keyboard: ↓ ↑ move, Enter picks, Esc closes (and only
 * that, so it doesn't also cancel the edit). ARIA: the combobox pattern.
 */
export function SuggestField({ id, value, onChange, onBlur, choices, label = 'Suggestions', invalid, placeholder = '', className = '' }) {
  const listId = useId();
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, placePanel] = usePlacement(open, inputRef, 220, 'end', { sheet: false });
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, [inputRef, panelRef], close);

  const needle = value.trim().toLowerCase();
  const matches = choices.filter((c) => c.toLowerCase() !== needle && (!needle || c.toLowerCase().includes(needle))).slice(0, 8);
  const showing = open && matches.length > 0;

  const show = () => { placePanel(); setActive(0); setOpen(true); };
  const pick = (c) => { onChange(c); setOpen(false); inputRef.current?.focus(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setActive((i) => Math.min(matches.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp' && showing) { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && showing) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Escape' && showing) { e.preventDefault(); e.stopPropagation(); close(); }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); if (!open) show(); setActive(0); }}
        onFocus={show}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        className={className}
      />
      {showing && (
        <PopoverPanel place={place} panelRef={panelRef} style={{ width: Math.max(place.width, 220) }}>
          <div id={listId} role="listbox" aria-label={label} className="overflow-y-auto overscroll-contain">
            {matches.map((c, i) => (
              <div
                key={c}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => active !== i && setActive(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={`cursor-pointer truncate rounded-md px-2.5 py-1.5 text-[15px] transition-colors duration-100 ${i === active ? 'bg-info text-white' : ''}`}
              >
                {c}
              </div>
            ))}
          </div>
        </PopoverPanel>
      )}
    </>
  );
}
