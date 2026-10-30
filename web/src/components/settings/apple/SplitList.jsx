import { accountArt } from '../../../lib/cards/account-art';

/**
 * The list side of an Apple split view in Settings (D297 Accounts, D298
 * Loans): grouped rows, the selection held in the accent for as long as its
 * detail is open (split-views.md: "persistently highlight the current
 * selection"), and up and down moving it (list-keys.js). Below `lg` a
 * row pushes its detail, so it carries a chevron there.
 */

/** An account as a little card, the same art the Cards page and Glass People use. */
export function MiniCard({ account, size = 'md' }) {
  const art = accountArt(account);
  const box = size === 'lg' ? 'h-[26px] w-10 rounded-[5px]' : 'h-6 w-9 rounded-[4px]';
  return (
    <span
      className={`relative flex shrink-0 items-end justify-end overflow-hidden p-0.5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.15)] ${box}`}
      style={art.style}
      aria-hidden="true"
    >
      {art.logo && <img src={art.logo} alt="" className="h-2.5 w-auto rounded-[2px] bg-white/90 px-px" />}
    </span>
  );
}

function Chevron({ selected }) {
  return (
    <svg width="7" height="12" viewBox="0 0 8 13" aria-hidden="true" className={`shrink-0 lg:hidden ${selected ? 'text-white/80' : 'text-faint'}`}>
      <path d="M1.5 1.5 6.5 6.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One selectable row. `suffix` sits after the title and never truncates
 * (an account's last four); `trailing(selected)` draws the right-hand
 * figures, in white once selected.
 */
export function ListRow({ id, selected, afterSelected, onSelect, leading, title, suffix, subtitle, trailing, dimmed = false }) {
  return (
    <li className="group/row">
      <button
        type="button"
        data-row-id={id}
        onClick={() => onSelect(id)}
        aria-current={selected ? 'true' : undefined}
        // Selected, it takes the accent as a macOS list's selection does, and
        // lifts a little; the hairlines either side of it step away. No z-index:
        // it would float over the sticky Settings toolbar while scrolling.
        className={`relative flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left transition-[background-color,box-shadow] duration-150 ${
          selected ? 'bg-info shadow-[0_6px_16px_-6px_var(--color-info)]' : 'hover:bg-band active:bg-band'
        }`}
      >
        {leading}
        <span className={`flex min-w-0 flex-1 items-center gap-3 self-stretch border-t py-2 group-first/row:border-transparent ${selected || afterSelected ? 'border-transparent' : 'border-rule'}`}>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5 text-[15px] leading-snug">
              <span className={`truncate ${selected ? 'font-medium text-white' : dimmed ? 'text-muted' : 'text-ink'}`}>{title}</span>
              {suffix && <span className={`shrink-0 text-[13px] tnum ${selected ? 'text-white/75' : 'text-faint'}`}>{suffix}</span>}
            </span>
            <span className={`block truncate text-[13px] leading-snug ${selected ? 'text-white/80' : 'text-muted'}`}>{subtitle || ' '}</span>
          </span>
          {trailing?.(selected)}
          <Chevron selected={selected} />
        </span>
      </button>
    </li>
  );
}

/** A group of rows under a small label, with an optional action on its right. */
export function ListSection({ label, children, action }) {
  return (
    <section>
      <div className="mb-1 flex items-end justify-between gap-3 px-3">
        <h4 className="text-[13px] font-medium text-muted">{label}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The "Closed · 2  Show" fold at the bottom of a list. */
export function ClosedFold({ count, open, onToggle, children }) {
  if (count === 0) return null;
  return (
    <ListSection
      label={`Closed · ${count}`}
      action={<button type="button" onClick={onToggle} aria-expanded={open} className="rounded-md text-[13px] text-info hover:underline">{open ? 'Hide' : 'Show'}</button>}
    >
      {open && <ul>{children}</ul>}
    </ListSection>
  );
}
