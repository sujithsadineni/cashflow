import { useCallback, useMemo, useRef, useState } from 'react';
import { useOutsideClose, usePlacement } from '../../use-popover';
import { PopoverPanel } from './PopoverPanel';
import { FieldTrigger } from './FieldTrigger';
import { useInField } from '../../field-context';
import { MONTHS_LONG, addMonths, dayCount, fromISO, longDate, monthDays, presetFor, rangeDays, rangeLabel, rangePresets, shortDate, todayISO } from '../../dates';

/**
 * The app's calendar (D230), in place of the browser's date input.
 *
 * DateRangePicker (the Transactions filter): shortcuts on the left (This
 * month … All time), two months side by side (one on a phone). Click a
 * start day, then an end day; the range previews as you hover. Shown as a
 * floating-label field reading "Last month · Sep 1–30".
 *
 * DatePicker (a single date, the Loans form): one month with month and
 * year steps, Today and Clear. Shown like the form's text fields.
 *
 * Both hand back ISO strings ('' when cleared), like <input type="date">.
 */

export const CalendarIcon = ({ size = 14 }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.8v2.6M10.5 1.8v2.6" />
  </svg>
);

const Arrow = ({ d }) => (
  <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const NavButton = ({ label, d, onClick }) => (
  <button type="button" aria-label={label} onClick={onClick} className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-band hover:text-ink">
    <Arrow d={d} />
  </button>
);

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * One month. `lo`/`hi` bound the selection (equal for a single date);
 * `preview` marks a range still being picked.
 */
function Month({ first, lo, hi, preview, today, onPick, onHover, left, right }) {
  const { lead, days } = monthDays(first);
  return (
    <div className="w-full sm:w-[15.5rem]">
      <div className="flex h-8 items-center justify-between">
        <span className="flex w-14 gap-0.5">{left}</span>
        <span className="font-medium text-ink">{MONTHS_LONG[first.getMonth()]} {first.getFullYear()}</span>
        <span className="flex w-14 justify-end gap-0.5">{right}</span>
      </div>
      <div className="grid grid-cols-7 pb-1 pt-1.5">
        {DOW.map((d) => <span key={d} className="text-center text-[0.6875rem] text-faint">{d}</span>)}
      </div>
      <div className="grid grid-cols-7" onMouseLeave={() => onHover?.(null)}>
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {days.map((iso) => {
          const inRange = lo && hi && iso >= lo && iso <= hi;
          const isEnd = iso === lo || iso === hi;
          // The tinted band joining the two ends: half a cell at each end.
          const band = inRange && lo !== hi
            ? ['before:absolute before:inset-y-0.5', iso === lo ? 'before:left-1/2' : 'before:left-0', iso === hi ? 'before:right-1/2' : 'before:right-0', preview ? 'before:bg-earn/[0.07]' : 'before:bg-earn/[0.13]'].join(' ')
            : '';
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              onMouseEnter={() => onHover?.(iso)}
              aria-label={longDate(iso)}
              aria-pressed={isEnd || undefined}
              className={`group relative h-[2.125rem] font-mono text-[0.8rem] tnum text-ink ${band}`}
            >
              <span className={`relative z-[1] mx-auto flex size-8 items-center justify-center rounded-full transition-colors ${
                isEnd ? 'bg-earn font-medium text-white' : `group-hover:bg-band ${iso === today ? 'ring-[1.5px] ring-rule-str ring-inset' : ''}`}`}
              >
                {Number(iso.slice(8))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function usePopover(minWidth) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [place, placePanel] = usePlacement(open, triggerRef, minWidth);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  const refs = useMemo(() => [triggerRef, panelRef], []);
  useOutsideClose(open, refs, close);
  const show = () => { placePanel(); setOpen(true); };
  const onKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  return { open, place, triggerRef, panelRef, close, show, onKeyDown };
}

const Footer = ({ children, actions }) => (
  <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-rule px-1.5 pb-0.5 pt-2">
    <span className="min-w-0 truncate">{children}</span>
    <span className="flex shrink-0 gap-1.5">{actions}</span>
  </div>
);
const FooterButton = (props) => (
  <button type="button" {...props} className="rounded-lg border border-rule-str bg-raised px-3 py-1 text-sm text-ink transition-colors hover:bg-band" />
);

export function DateRangePicker({ from, to, onChange, label = 'Date', className = '' }) {
  const today = todayISO();
  const { open: isOpen, place, triggerRef, panelRef, close, show, onKeyDown } = usePopover(720);
  const [start, setStart] = useState(null); // the first click of a range still being picked
  const [hover, setHover] = useState(null);
  const [view, setView] = useState(null); // the left month shown
  const [two, setTwo] = useState(true); // two months side by side when there's room

  const set = Boolean(from || to);
  const preset = presetFor(from, to, today);
  const openPanel = () => {
    setStart(null);
    setHover(null);
    const wide = window.innerWidth >= 900;
    setTwo(wide);
    setView(addMonths(fromISO(to || from || today), wide ? -1 : 0));
    show();
  };
  const finish = (a, b) => { close(); onChange(a, b); };
  const pickDay = (iso) => {
    if (!start) { setStart(iso); return; }
    finish(iso < start ? iso : start, iso < start ? start : iso);
  };

  // While picking, the range runs from the first click to the hovered day.
  const [lo, hi] = start
    ? [hover && hover < start ? hover : start, hover && hover > start ? hover : start]
    : [from || null, to || null];
  const months = view ? (two ? [view, addMonths(view, 1)] : [view]) : [];

  return (
    <>
      <FieldTrigger
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : openPanel())}
        label={label}
        value={rangeLabel(from, to, today)}
        set={set}
        icon={<CalendarIcon />}
        iconColor="var(--color-earn)"
        fieldIcon={<CalendarIcon />}
        tail={preset ? <span className="hidden font-mono text-xs tnum text-faint lg:inline">{rangeDays(from, to, today)}</span> : null}
        open={isOpen}
        className={className}
      />
      {isOpen && (
        <PopoverPanel place={place} panelRef={panelRef} onKeyDown={onKeyDown} role="dialog" aria-label="Pick dates" className="overflow-y-auto p-2" style={{ width: 'auto', maxWidth: 'calc(100vw - 32px)' }}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-wrap gap-1 border-b border-rule pb-2 sm:w-48 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r sm:pb-0 sm:pr-2">
              {rangePresets(today).map((r) => {
                const on = r.from ? preset?.label === r.label : !set;
                return (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => finish(r.from, r.to)}
                    className={`flex items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left transition-colors ${on ? 'bg-earn/[0.13] font-medium text-earn' : 'text-ink hover:bg-band'}`}
                  >
                    {r.label}
                    {r.hint && <span className="hidden font-mono text-[0.6875rem] text-faint sm:inline">{r.hint}</span>}
                  </button>
                );
              })}
            </div>
            <div className="min-w-0">
              <div className="flex gap-5 px-1">
                {months.map((m, i) => (
                  <Month
                    key={m.getTime()}
                    first={m}
                    lo={lo}
                    hi={hi}
                    preview={Boolean(start)}
                    today={today}
                    onPick={pickDay}
                    onHover={start ? setHover : null}
                    left={i === 0 && <NavButton label="Previous month" d="M10 4L6 8l4 4" onClick={() => setView(addMonths(view, -1))} />}
                    right={i === months.length - 1 && <NavButton label="Next month" d="M6 4l4 4-4 4" onClick={() => setView(addMonths(view, 1))} />}
                  />
                ))}
              </div>
              <Footer actions={<FooterButton onClick={() => finish('', '')}>Clear</FooterButton>}>
                {start ? (
                  <span className="text-muted">From <b className="font-medium text-ink">{shortDate(start, today)}</b>. Now pick the end date</span>
                ) : from && to ? (
                  <><b className="font-medium">{shortDate(from, today)} – {shortDate(to, today)}</b> <span className="font-mono text-xs tnum text-faint">{dayCount(from, to)} days</span></>
                ) : (
                  <span className="text-muted">Pick a start date, then an end date</span>
                )}
              </Footer>
            </div>
          </div>
        </PopoverPanel>
      )}
    </>
  );
}

export function DatePicker({ value, onChange, placeholder = 'Pick a date', invalid = false, className = '', ...aria }) {
  const today = todayISO();
  const inField = useInField();
  const { open: isOpen, place, triggerRef, panelRef, close, show, onKeyDown } = usePopover(288);
  const [view, setView] = useState(null);
  const openPanel = () => { setView(addMonths(fromISO(value || today), 0)); show(); };
  const finish = (iso) => { close(); onChange(iso); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-invalid={invalid || undefined}
        {...aria}
        onClick={() => (isOpen ? close() : openPanel())}
        className={inField
          ? `flex w-full min-w-0 items-center gap-2 py-0.5 text-left leading-snug focus-visible:outline-none ${className}`
          : `flex w-full items-center gap-2 rounded-md border bg-raised px-3 py-2 text-left transition-colors hover:border-rule-str focus-visible:border-earn focus-visible:outline-none ${
            isOpen ? 'border-earn ring-3 ring-earn/15' : invalid ? 'border-spend' : 'border-rule'} ${className}`}
      >
        <span className="text-muted"><CalendarIcon /></span>
        <span className={`min-w-0 flex-1 truncate tnum ${value ? 'text-ink' : 'text-faint'}`}>{value ? shortDate(value, '') : placeholder}</span>
      </button>
      {isOpen && view && (
        <PopoverPanel place={place} panelRef={panelRef} onKeyDown={onKeyDown} role="dialog" aria-label="Pick a date" className="p-2" style={{ width: 'auto' }}>
          <div className="px-1">
            <Month
              first={view}
              lo={value || null}
              hi={value || null}
              today={today}
              onPick={finish}
              left={<>
                <NavButton label="Previous year" d="M9 4L5 8l4 4M13 4L9 8l4 4" onClick={() => setView(addMonths(view, -12))} />
                <NavButton label="Previous month" d="M10 4L6 8l4 4" onClick={() => setView(addMonths(view, -1))} />
              </>}
              right={<>
                <NavButton label="Next month" d="M6 4l4 4-4 4" onClick={() => setView(addMonths(view, 1))} />
                <NavButton label="Next year" d="M3 4l4 4-4 4M7 4l4 4-4 4" onClick={() => setView(addMonths(view, 12))} />
              </>}
            />
          </div>
          <Footer actions={<><FooterButton onClick={() => finish('')}>Clear</FooterButton><FooterButton onClick={() => finish(today)}>Today</FooterButton></>}>
            {value ? <b className="font-medium">{longDate(value)}</b> : <span className="text-muted">No date</span>}
          </Footer>
        </PopoverPanel>
      )}
    </>
  );
}
