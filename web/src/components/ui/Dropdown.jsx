import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOutsideClose, usePlacement } from '../../hooks/use-popover';
import { PopoverPanel } from './PopoverPanel';
import { FieldTrigger } from './FieldTrigger';
import { useInField } from '../../context/field-context';

/**
 * The app's one dropdown (D229), in place of the browser's <select>.
 * What it does depends on how long its list is, so no screen has to choose:
 *   - up to 5 options: a plain list
 *   - 6 to 12: the same, plus each option's hint line; typing jumps to an option
 *   - 13 or more: a wide two-column panel with a search box (focused on
 *     open), the last three picks first, then the options in their groups
 * Each option may carry an icon and a colour, drawn as a round badge (the
 * Cards page's chip look), a hint, a group and a faint suffix (an account's
 * last four). Builders live in dropdown-choices.jsx.
 *
 * The panel is portalled to <body>: it is never clipped by a table's
 * overflow, and a click inside it can't re-trigger a wrapping <label>.
 * On a phone it opens as a sheet from the bottom. Keyboard: ↑ ↓ Home End,
 * Enter picks, Esc closes. ARIA: the listbox pattern.
 *
 * `quiet` reads as plain text until hovered, for table cells.
 *
 * `inRow` (D297) is the value of an Apple-style form row: plain text on the
 * trailing edge with the pop-up's up-and-down chevrons, a soft tint while
 * hovered, focused or open, never a border or ring, the menu hung from its
 * right edge, the highlighted option in the accent as a macOS menu draws it,
 * and the choice ticked.
 *
 * `multiple` (D287): `value` is an array and `onChange` gets an array. A pick
 * ticks or unticks and the panel stays open; the blank option ("All")
 * clears them all and closes. The field reads "Groceries +2".
 */

const MEDIUM = 6;
const LONG = 13;

const readRecent = (key) => {
  try { return JSON.parse(localStorage.getItem(`cashflow.recent.${key}`)) ?? []; } catch { return []; }
};
const writeRecent = (key, values) => {
  try { localStorage.setItem(`cashflow.recent.${key}`, JSON.stringify(values)); } catch { /* private window: no recents */ }
};

function Badge({ option, size = 'size-6', shape = 'rounded-full' }) {
  if (!option?.icon) return null;
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center ${shape} text-white`} style={{ backgroundColor: option.color }} aria-hidden="true">
      {option.icon}
    </span>
  );
}

function Highlight({ text, needle }) {
  const i = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="rounded-sm bg-earn/20 text-inherit">{text.slice(i, i + needle.length)}</mark>{text.slice(i + needle.length)}</>;
}

const Chevron = ({ open }) => (
  <svg viewBox="0 0 16 16" className={`size-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
/** A pop-up button's up-and-down chevrons (inRow). */
const UpDown = () => (
  <svg width="8" height="12" viewBox="0 0 8 12" className="shrink-0 text-faint" aria-hidden="true">
    <path d="M1 4.2 4 1.2l3 3M1 7.8l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Check = ({ tone = 'text-earn' }) => (
  <svg viewBox="0 0 16 16" className={`size-3.5 shrink-0 ${tone}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// `pager` (D397): the page-size control at the end of a pager, 'round' (Apple's pill) or 'square' (Vivid's box).
export function Dropdown({ value, onChange, options, placeholder = 'Pick one…', quiet = false, inRow = false, invalid = false, recentKey, label, fieldIcon, className = '', id, multiple = false, columns = 2, pager = null, ...aria }) {
  const autoId = useId();
  const baseId = id ?? `dd${autoId.replace(/:/g, '')}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(() => (recentKey ? readRecent(recentKey) : []));
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const typed = useRef({ text: '', at: 0 });

  const current = multiple ? '' : value == null ? '' : String(value);
  const chosen = useMemo(() => new Set(multiple ? (value ?? []).map(String) : []), [multiple, value]);
  const isChosen = (o) => (multiple ? chosen.has(String(o.value)) : String(o.value) === current);
  const picked = multiple ? options.filter((o) => o.value !== '' && chosen.has(String(o.value))) : [];
  const selected = multiple
    ? picked[0] && { ...picked[0], label: picked.length > 1 ? `${picked[0].label} +${picked.length - 1}` : picked[0].label, sub: picked.length > 1 ? null : picked[0].sub }
    : options.find((o) => String(o.value) === current);
  const long = options.length >= LONG;
  const showHints = options.length >= MEDIUM;
  const needle = query.trim().toLowerCase();
  // `columns={3}` (D372): a long list three across, the Where picker's look — rounded tiles, a count under each.
  const wide3 = long && columns === 3;
  const [place, placePanel] = usePlacement(open, triggerRef, wide3 ? 640 : long ? 544 : showHints ? 288 : 208, inRow ? 'end' : 'start');

  // The rows on screen, in order: [{ group, option }] with the group shown on its first row.
  const rows = useMemo(() => {
    if (!long) return options.map((option) => ({ option }));
    const hit = (o) => !needle || o.label.toLowerCase().includes(needle) || (o.sub ?? '').toLowerCase().includes(needle);
    const out = [];
    // Ungrouped options ("All", "—") first, then recent picks, then the groups.
    const groups = new Map([['', []]]);
    for (const o of options.filter(hit)) {
      const g = o.group ?? '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(o);
    }
    const add = (g, list) => list.forEach((option, i) => out.push({ option, group: i === 0 && g ? g : null }));
    add('', groups.get(''));
    if (!needle) {
      const picks = recent.map((v) => options.find((o) => String(o.value) === v && v !== '')).filter(Boolean);
      picks.forEach((option, i) => out.push({ option, group: i === 0 ? 'Recently picked' : null, recent: true }));
    }
    for (const [g, list] of groups) if (g) add(g, list);
    return out;
  }, [long, options, needle, recent]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  }, []);

  const show = () => {
    // Opens with the current choice highlighted (its place in its group, not among recent picks).
    setActive(Math.max(0, rows.findIndex((r) => !r.recent && (multiple ? chosen.has(String(r.option.value)) : String(r.option.value) === current))));
    placePanel();
    setOpen(true);
  };

  const pick = (option) => {
    if (!option) return;
    if (recentKey && option.value !== '') {
      const next = [String(option.value), ...recent.filter((v) => v !== String(option.value))].slice(0, 3);
      setRecent(next);
      writeRecent(recentKey, next);
    }
    if (multiple) {
      const v = String(option.value);
      if (v === '') { close(); if (chosen.size) onChange([]); return; }
      onChange(chosen.has(v) ? [...chosen].filter((x) => x !== v) : [...chosen, v]);
      return;
    }
    close();
    if (String(option.value) !== current) onChange(String(option.value));
  };

  // Focus moves into the panel as it opens: the search box, or the list itself.
  useEffect(() => {
    if (!open || !place) return;
    (searchRef.current ?? panelRef.current)?.focus({ preventScroll: true });
  }, [open, place]);

  // The active row stays in view as the arrows move it.
  useEffect(() => {
    if (open) panelRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const refs = useMemo(() => [triggerRef, panelRef], []);
  useOutsideClose(open, refs, close);

  const onKey = (e) => {
    const last = rows.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, last)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(last); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(rows[active]?.option); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (!long && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const t = typed.current;
      t.text = Date.now() - t.at > 700 ? e.key : t.text + e.key;
      t.at = Date.now();
      const i = rows.findIndex((r) => r.option.label.toLowerCase().startsWith(t.text.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  const inField = useInField();
  const triggerClass = pager
    ? `inline-flex items-center gap-2 whitespace-nowrap border bg-raised text-ink transition-colors focus-visible:outline-none ${
      pager === 'round' ? 'rounded-full px-4 py-1.5 text-[15px]' : 'rounded-lg px-3 py-1.5 text-sm'} ${
      open ? 'border-info ring-3 ring-info/15' : 'border-rule hover:border-rule-str focus-visible:border-info'}`
    : inRow
    ? `-mr-1.5 inline-flex max-w-full items-center justify-end gap-1.5 rounded-md px-1.5 py-0.5 text-right text-ink transition-colors duration-150 hover:bg-band focus-visible:bg-band focus-visible:outline-none ${open ? 'bg-band' : ''}`
    : inField
    ? 'flex w-full min-w-0 items-center gap-2 py-0.5 text-left leading-snug text-ink focus-visible:outline-none'
    : quiet
    ? `inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-rule hover:bg-band focus-visible:border-info focus-visible:outline-none ${open ? 'border-info bg-band' : ''}`
    : `flex w-full min-w-40 items-center gap-2 rounded-md border bg-raised px-3 py-2 text-left text-ink transition-colors hover:border-rule-str focus-visible:border-info focus-visible:outline-none ${
      open ? 'border-info ring-3 ring-info/15' : invalid ? 'border-spend' : 'border-rule'}`;

  const listId = `${baseId}-list`;
  const optionId = (i) => `${baseId}-o${i}`;

  const panel = open && (
    <PopoverPanel
      place={place}
      panelRef={panelRef}
      onKeyDown={onKey}
      style={{ width: long ? place?.width : undefined, minWidth: place && Math.min(place.width, Math.max(place.minWidth, showHints ? 288 : 0)), maxWidth: place?.width }}
    >
        {long && (
          <div className="flex items-center gap-2 border-b border-rule px-2 pb-2 pt-1.5">
            <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" strokeLinecap="round" /></svg>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder="Type to search"
              aria-label="Search"
              aria-controls={listId}
              aria-activedescendant={rows[active] ? optionId(active) : undefined}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
            />
            <span className="font-mono text-xs tnum text-faint">{needle ? `${rows.length} of ${options.length}` : options.length}</span>
          </div>
        )}
        <div
          id={listId}
          role="listbox"
          aria-label={aria['aria-label']}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={!long && rows[active] ? optionId(active) : undefined}
          className={`min-h-0 overflow-y-auto overscroll-contain ${long ? `grid content-start gap-x-1 pt-1 ${wide3 ? 'grid-cols-2 sm:grid-cols-3' : 'sm:grid-cols-2'}` : ''}`}
        >
          {rows.length === 0 && <div className="px-2 py-2.5 text-muted">Nothing matches “{query}”.</div>}
          {rows.map(({ option, group, recent: isRecent }, i) => {
            const isSelected = isChosen(option);
            return (
              <div key={`${isRecent ? 'r' : 'o'}${option.value}`} className="contents">
                {group && <div className="col-span-full px-2 pb-1 pt-2.5 text-xs text-faint">{group}</div>}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSelected}
                  data-i={i}
                  onMouseMove={() => active !== i && setActive(i)}
                  onClick={() => pick(option)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 ${i === active ? (inRow ? 'bg-info text-white' : 'bg-band') : ''}`}
                >
                  {wide3 ? <Badge option={option} size="size-8" shape="rounded-lg" /> : <Badge option={option} />}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${isSelected ? 'font-medium' : ''}`}><Highlight text={option.label} needle={needle} /></span>
                    {showHints && option.hint && <span className="block truncate text-xs text-faint">{option.hint}</span>}
                  </span>
                  {option.sub && <span className="shrink-0 font-mono text-xs tnum text-faint"><Highlight text={option.sub} needle={needle} /></span>}
                  <span className={`flex size-3.5 shrink-0 ${isSelected ? '' : 'invisible'}`}><Check tone={inRow ? (i === active ? 'text-white' : 'text-info') : undefined} /></span>
                </div>
              </div>
            );
          })}
        </div>
    </PopoverPanel>
  );

  const triggerProps = {
    ref: triggerRef,
    id: baseId,
    'aria-haspopup': 'listbox',
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    ...aria,
    onClick: () => (open ? close() : show()),
    onKeyDown: (e) => {
      if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
    },
  };

  // The floating-label field (D230): the Transactions filters.
  if (label) {
    const set = Boolean(selected && selected.value !== '');
    return (
      <>
        <FieldTrigger
          {...triggerProps}
          label={label}
          value={selected?.label}
          placeholder={placeholder}
          set={set}
          icon={selected?.icon}
          iconColor={selected?.color}
          fieldIcon={fieldIcon}
          tail={set && selected?.sub ? <span className="font-mono text-xs tnum text-faint">{selected.sub}</span> : null}
          open={open}
          className={className}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        {...triggerProps}
        aria-invalid={invalid || undefined}
        className={`group ${triggerClass} ${className}`}
      >
        {!quiet && !inRow && !pager && <Badge option={selected} size="size-5" />}
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-faint'}`}>{selected?.label ?? placeholder}</span>
        {!quiet && !inRow && selected?.sub && <span className="shrink-0 font-mono text-xs tnum text-faint">{selected.sub}</span>}
        {inRow ? <UpDown /> : <span className={quiet && !open ? 'opacity-0 transition-opacity group-hover:opacity-100' : ''}><Chevron open={open} /></span>}
      </button>
      {panel}
    </>
  );
}
