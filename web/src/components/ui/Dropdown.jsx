import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOutsideClose, usePlacement } from '../../use-popover';
import { PopoverPanel } from './PopoverPanel';
import { FieldTrigger } from './FieldTrigger';
import { useInField } from '../../field-context';

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
 */

const MEDIUM = 6;
const LONG = 13;

const readRecent = (key) => {
  try { return JSON.parse(localStorage.getItem(`cashflow.recent.${key}`)) ?? []; } catch { return []; }
};
const writeRecent = (key, values) => {
  try { localStorage.setItem(`cashflow.recent.${key}`, JSON.stringify(values)); } catch { /* private window: no recents */ }
};

function Badge({ option, size = 'size-6' }) {
  if (!option?.icon) return null;
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full text-white`} style={{ backgroundColor: option.color }} aria-hidden="true">
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
const Check = () => (
  <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-earn" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Dropdown({ value, onChange, options, placeholder = 'Pick one…', quiet = false, invalid = false, recentKey, label, fieldIcon, className = '', id, ...aria }) {
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

  const current = value == null ? '' : String(value);
  const selected = options.find((o) => String(o.value) === current);
  const long = options.length >= LONG;
  const showHints = options.length >= MEDIUM;
  const needle = query.trim().toLowerCase();
  const [place, placePanel] = usePlacement(open, triggerRef, long ? 544 : showHints ? 288 : 208);

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
    setActive(Math.max(0, rows.findIndex((r) => !r.recent && String(r.option.value) === current)));
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
  const triggerClass = inField
    ? 'flex w-full min-w-0 items-center gap-2 py-0.5 text-left leading-snug text-ink focus-visible:outline-none'
    : quiet
    ? `inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-rule hover:bg-band focus-visible:border-earn focus-visible:outline-none ${open ? 'border-earn bg-band' : ''}`
    : `flex w-full min-w-40 items-center gap-2 rounded-md border bg-raised px-3 py-2 text-left text-ink transition-colors hover:border-rule-str focus-visible:border-earn focus-visible:outline-none ${
      open ? 'border-earn ring-3 ring-earn/15' : invalid ? 'border-spend' : 'border-rule'}`;

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
          aria-activedescendant={!long && rows[active] ? optionId(active) : undefined}
          className={`min-h-0 overflow-y-auto overscroll-contain ${long ? 'grid content-start gap-x-1 pt-1 sm:grid-cols-2' : ''}`}
        >
          {rows.length === 0 && <div className="px-2 py-2.5 text-muted">Nothing matches “{query}”.</div>}
          {rows.map(({ option, group, recent: isRecent }, i) => {
            const isSelected = String(option.value) === current;
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
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 ${i === active ? 'bg-band' : ''}`}
                >
                  <Badge option={option} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${isSelected ? 'font-medium' : ''}`}><Highlight text={option.label} needle={needle} /></span>
                    {showHints && option.hint && <span className="block truncate text-xs text-faint">{option.hint}</span>}
                  </span>
                  {option.sub && <span className="shrink-0 font-mono text-xs tnum text-faint"><Highlight text={option.sub} needle={needle} /></span>}
                  <span className={`flex size-3.5 shrink-0 ${isSelected ? '' : 'invisible'}`}><Check /></span>
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
        {!quiet && <Badge option={selected} size="size-5" />}
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-faint'}`}>{selected?.label ?? placeholder}</span>
        {!quiet && selected?.sub && <span className="shrink-0 font-mono text-xs tnum text-faint">{selected.sub}</span>}
        <span className={quiet && !open ? 'opacity-0 transition-opacity group-hover:opacity-100' : ''}><Chevron open={open} /></span>
      </button>
      {panel}
    </>
  );
}
