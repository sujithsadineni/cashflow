import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useOutsideClose, usePlacement } from '../../hooks/use-popover';
import { PopoverPanel } from '../ui/PopoverPanel';
import { FieldTrigger } from '../ui/FieldTrigger';
import { avatarColorFor } from '../../lib/transactions/merchant-logos';
import { placeTree, placeLabel } from '../../lib/transactions/place-groups';
import { STATE_SHAPES } from '../../lib/transactions/state-shapes';

/**
 * The Where filter (D370): the states first, three to a row, each with its
 * badge (its outline, D371) and how often the household bought there; a state opens its cities,
 * "All of Texas" first. Anywhere is the default and Online sits beside it.
 * Typing searches every city and state at once. Several places can be picked
 * (a tick on each); a whole state is one pick ("state:TX"). Built from the same
 * trigger, panel and placement as the app's Dropdown, so it matches the other
 * filters closed; a phone gets the same bottom sheet, two to a row.
 */

const Tick = () => (
  <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-info" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Chevron = ({ dir = 'right' }) => (
  <svg viewBox="0 0 16 16" className={`size-3.5 shrink-0 text-faint ${dir === 'left' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A state's badge: its outline in white on a tile in its own colour (D371); its two letters where there's no outline. */
function StateBadge({ state, size = 'size-8' }) {
  const shape = state.code && STATE_SHAPES[state.code];
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tracking-wide text-white`} style={{ backgroundColor: avatarColorFor(state.name) }} aria-hidden="true">
      {shape
        ? <svg viewBox="0 0 24 24" className="size-[78%]"><path d={shape} fill="currentColor" fillRule="evenodd" /></svg>
        : state.code ?? '··'}
    </span>
  );
}

const count = (n) => n.toLocaleString();

/** One choice in the grid: a state (opens), or a place / a whole state (picks). */
function Choice({ chosen, onClick, lead, title, sub, trail, className = '', ...data }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={chosen ?? undefined} {...data}
      className={`flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-band focus-visible:bg-band focus-visible:outline-none ${chosen ? 'bg-info/10' : ''} ${className}`}>
      {lead}
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${chosen ? 'font-medium text-info' : 'text-ink'}`}>{title}</span>
        {sub && <span className="block truncate text-xs text-faint tnum">{sub}</span>}
      </span>
      {trail}
    </button>
  );
}

export function PlacePicker({ value = [], onChange, places = [], fieldIcon, className = '' }) {
  const baseId = `pp${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null); // the state whose cities are showing
  const [query, setQuery] = useState('');
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const [place, placePanel] = usePlacement(open, triggerRef, 640, 'end');
  const { online, states } = useMemo(() => placeTree(places), [places]);
  const chosen = new Set(value);
  const needle = query.trim().toLowerCase();

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    setState(null);
    if (refocus) triggerRef.current?.focus();
  }, []);
  useOutsideClose(open, [triggerRef, panelRef], close);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open, state]);

  const toggle = (key) => onChange(chosen.has(key) ? value.filter((v) => v !== key) : [...value, key]);
  const shown = state && states.find((s) => s.name === state);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); if (state && !needle) setState(null); else close(); }
    if (e.key === 'Backspace' && !query && state) { e.preventDefault(); setState(null); }
  };

  // Typing: every city and every state that matches.
  const found = needle
    ? [
      ...states.filter((s) => s.key && s.name.toLowerCase().includes(needle)).map((s) => ({ kind: 'state', s })),
      ...states.flatMap((s) => s.cities.filter((c) => c.city.toLowerCase().includes(needle)).map((c) => ({ kind: 'city', c, s }))),
    ]
    : null;

  const summary = value.length === 0 ? null : value.length === 1 ? placeLabel(places, value[0]) : `${placeLabel(places, value[0])} +${value.length - 1}`;
  const grid = 'grid content-start gap-0.5 sm:grid-cols-3 grid-cols-2';

  const panel = open && (
    <PopoverPanel place={place} panelRef={panelRef} onKeyDown={onKey} style={{ width: place?.width }} aria-label="Where">
      <div className="flex items-center gap-2 border-b border-rule px-2 pb-2 pt-1.5">
        {shown && !needle ? (
          <button type="button" onClick={() => setState(null)} className="-ml-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] font-medium text-info hover:bg-info/10">
            <Chevron dir="left" />States
          </button>
        ) : (
          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" strokeLinecap="round" /></svg>
        )}
        <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={shown ? `Search ${shown.name}` : 'Search a city or state'} aria-label="Search places"
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint" />
        {value.length > 0 && <button type="button" onClick={() => onChange([])} className="shrink-0 rounded-md px-1.5 py-0.5 text-[13px] text-info hover:bg-info/10">Clear</button>}
      </div>

      <div id={`${baseId}-list`} className="min-h-0 overflow-y-auto overscroll-contain p-1">
        {found && (
          found.length === 0
            ? <p className="px-2 py-3 text-muted">Nothing matches “{query}”.</p>
            : (
              <div className={grid}>
                {found.map((f) => (f.kind === 'state'
                  ? <Choice key={f.s.key} chosen={chosen.has(f.s.key)} onClick={() => toggle(f.s.key)} lead={<StateBadge state={f.s} />} title={`All of ${f.s.name}`} sub={`${count(f.s.count)} purchases`} trail={chosen.has(f.s.key) && <Tick />} />
                  : <Choice key={f.c.key} chosen={chosen.has(f.c.key)} onClick={() => toggle(f.c.key)} title={f.c.city} sub={`${f.s.code ?? f.s.name} · ${count(f.c.count)}`} trail={chosen.has(f.c.key) && <Tick />} />))}
              </div>
            )
        )}

        {!found && !shown && (
          <>
            <div className="grid grid-cols-2 gap-0.5 border-b border-rule pb-1">
              <Choice chosen={value.length === 0} onClick={() => onChange([])} title="Anywhere" sub="Every place" trail={value.length === 0 && <Tick />} />
              {online && <Choice chosen={chosen.has('online')} onClick={() => toggle('online')} title="Online" sub={`${count(online.count)} purchases`} trail={chosen.has('online') && <Tick />} />}
            </div>
            <p className="px-2 pb-1 pt-2.5 text-xs text-faint">States · {states.length}</p>
            <div className={grid}>
              {states.map((s) => {
                const picked = (s.key && chosen.has(s.key)) || s.cities.some((c) => chosen.has(c.key));
                return (
                  <Choice key={s.name} data-state={s.code ?? undefined} chosen={picked} onClick={() => { setState(s.name); setQuery(''); }} lead={<StateBadge state={s} />}
                    title={s.name} sub={`${count(s.count)} · ${s.cities.length} ${s.cities.length === 1 ? 'city' : 'cities'}`} trail={<Chevron />} />
                );
              })}
            </div>
          </>
        )}

        {!found && shown && (
          <>
            <div className="flex items-center gap-3 px-2 pb-2 pt-1">
              <StateBadge state={shown} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{shown.name}</span>
                <span className="block text-xs text-faint tnum">{count(shown.count)} purchases · {shown.cities.length} {shown.cities.length === 1 ? 'city' : 'cities'}</span>
              </span>
            </div>
            {shown.key && (
              <div className="border-b border-rule pb-1">
                <Choice chosen={chosen.has(shown.key)} onClick={() => toggle(shown.key)} title={`All of ${shown.name}`} sub={`${count(shown.count)} purchases`} trail={chosen.has(shown.key) && <Tick />} />
              </div>
            )}
            <div className={`${grid} pt-1`}>
              {shown.cities.map((c) => (
                <Choice key={c.key} chosen={chosen.has(c.key)} onClick={() => toggle(c.key)} title={c.city} sub={count(c.count)} trail={chosen.has(c.key) && <Tick />} />
              ))}
            </div>
          </>
        )}
      </div>
    </PopoverPanel>
  );

  return (
    <>
      <FieldTrigger
        ref={triggerRef}
        id={baseId}
        aria-haspopup="dialog"
        aria-expanded={open}
        label="Where"
        value={summary}
        placeholder="Anywhere"
        set={value.length > 0}
        fieldIcon={fieldIcon}
        open={open}
        className={className}
        onClick={() => (open ? close() : (placePanel(), setOpen(true)))}
        onKeyDown={(e) => { if (!open && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); placePanel(); setOpen(true); } }}
      />
      {panel}
    </>
  );
}
