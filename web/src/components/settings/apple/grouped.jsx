/**
 * Apple's inset grouped list (D297), from shared tokens so it renders in
 * every design: a small header above a rounded group, rows with a label on
 * the leading edge and a value on the trailing one, hairlines that start
 * past the leading inset, and a footnote below (lists-and-tables.md: "the
 * grouped style uses headers, footers, and additional space to separate
 * groups of data"). Glass's own `gs-*` classes are Glass-only; these aren't.
 */

export function GroupBlock({ header, footer, children, className = '' }) {
  return (
    <section className={className}>
      {header && <h4 className="mb-1.5 px-4 text-[13px] font-normal text-muted">{header}</h4>}
      <div className="inset-group overflow-hidden rounded-xl border border-rule bg-raised">{children}</div>
      {footer && <div className="mt-1.5 px-4 text-[13px] leading-snug text-muted">{footer}</div>}
    </section>
  );
}

/**
 * One row. `label` leads; `children` is the trailing value or control.
 * `as="label"` makes the whole row focus its input when clicked, as a
 * tap anywhere on an iOS form row does.
 */
export function GroupRow({ label, children, invalid = false, as: Tag = 'div', htmlFor, className = '' }) {
  return (
    <Tag htmlFor={htmlFor} className={`group/grow block pl-4 transition-colors duration-150 ${className}`}>
      <div className="flex min-h-11 items-center gap-4 border-t border-rule py-2 pr-4 group-first/grow:border-transparent">
        {label && <span className={`shrink-0 text-[15px] ${invalid ? 'text-spend' : 'text-ink'}`}>{label}</span>}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right text-[15px] text-muted">{children}</div>
      </div>
    </Tag>
  );
}

/** A full-width action row: centred text, in the action's own colour (Close Account in spend). */
export function GroupButton({ children, onClick, tone = 'info', disabled = false }) {
  const colour = { info: 'text-info', spend: 'text-spend' }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-11 w-full items-center justify-center px-4 text-[15px] outline-none transition-colors hover:bg-band focus-visible:bg-band active:bg-band disabled:opacity-40 ${colour}`}
    >
      {children}
    </button>
  );
}

/** The chevron of a row that goes somewhere. */
export function RowChevron() {
  return (
    <svg width="7" height="12" viewBox="0 0 8 13" aria-hidden="true" className="shrink-0 text-faint">
      <path d="M1.5 1.5 6.5 6.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The large card art at the top of the detail, Wallet-style. */
export function CardArt({ art, className = '' }) {
  return (
    <span
      className={`relative flex aspect-[1.586] shrink-0 items-end justify-end overflow-hidden rounded-[10px] p-2 shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_4px_14px_rgb(0_0_0/0.18)] ${className}`}
      style={art.style}
      aria-hidden="true"
    >
      {art.logo && <img src={art.logo} alt="" className="h-5 w-auto rounded-[3px] bg-white/90 px-0.5" />}
    </span>
  );
}
