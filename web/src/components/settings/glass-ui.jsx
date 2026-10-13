/**
 * Glass Settings' building blocks (D244), after iOS/macOS grouped lists:
 * a small sentence-case label above a group, the white rounded group, rows
 * whose separators start past the icon, and a footnote below. Glass only;
 * the classes they use are styled under :root[data-design="glass"].
 */
import { motion, useReducedMotion } from 'motion/react';

/** A pane's section: label (and an optional action) above, footnote below. */
export function GroupSection({ label, action, footnote, children, className = '' }) {
  return (
    <section className={className}>
      {(label || action) && (
        <div className="mb-1.5 flex items-end justify-between gap-3 px-4">
          {label ? <h4 className="text-[13px] font-normal text-muted">{label}</h4> : <span />}
          {action}
        </div>
      )}
      {children}
      {footnote && <p className="mt-1.5 px-4 text-[13px] leading-snug text-muted">{footnote}</p>}
    </section>
  );
}

/** The white rounded group itself. `inset` is where row separators start, in px. */
export function Group({ children, inset = 16, as: Tag = 'ul', className = '', ...rest }) {
  return (
    <Tag className={`gs-group ${className}`} style={{ '--gs-inset': `${inset}px` }} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * One row: leading (icon), title and subtitle, trailing (value, switch,
 * chevron). With `onClick` the whole row is the button; otherwise it's static.
 */
export function Row({ leading, title, subtitle, trailing, onClick, actionProps, children, wrap = false, className = '', as: Tag = 'li' }) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-snug text-ink">{title}</span>
        {subtitle && <span className={`mt-0.5 block text-[13px] leading-snug text-muted ${wrap ? '' : 'truncate'}`}>{subtitle}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
    </>
  );
  return (
    <Tag className={`gs-row ${className}`}>
      {onClick ? (
        <button type="button" onClick={onClick} {...actionProps} className="gs-row-action flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left">
          {body}
        </button>
      ) : (
        <div className="flex min-h-11 items-center gap-3 px-4 py-2.5">{body}</div>
      )}
      {children}
    </Tag>
  );
}

/** The iOS switch. A real switch for assistive tech; the label names it. */
export function Switch({ on, onToggle, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="gs-switch disabled:opacity-40"
    >
      <span className="gs-switch-knob" />
    </button>
  );
}

/** A rounded-square icon tile in a system colour, like Settings' pane icons. */
export function Tile({ color, size = 28, children }) {
  return (
    <span
      className="gs-tile flex shrink-0 items-center justify-center text-white"
      style={{ backgroundColor: color, width: size, height: size, borderRadius: Math.round(size * 0.27) }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/** The trailing chevron of a row that opens something. */
export function Chevron({ open = false }) {
  return (
    <svg
      width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"
      className="text-faint transition-transform duration-200"
      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path d="M1.5 1.5 6.5 6.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The toolbar of an Apple Settings window (D245, shared by D248): each item
 * an icon tile over its label, groups split by a hairline, the selection a
 * soft fill that slides between items. Glass, sticky under the top edge.
 * `actions` sit after a last hairline: buttons that do something rather
 * than select (Refresh), so they never take the selection. An option's
 * `badge` is a count on its tile, as iOS badges an app (D249). Margins go in
 * `className`, never on a wrapper: a sticky element only sticks within its
 * parent, so a wrapper its own height pins it in place (D253).
 */
export function GlassToolbar({ label, groups, value, onChange, renderIcon, actions = [], layoutId, className = '' }) {
  const reduceMotion = useReducedMotion();
  const glide = reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.35 };
  const item = 'relative flex w-full flex-col items-center gap-1 rounded-[11px] px-1 pt-1.5 pb-1 text-[12px] leading-tight transition-colors';

  return (
    <nav aria-label={label} className={`app-topbar sticky top-[4.5rem] z-10 overflow-x-auto rounded-[18px] border px-2 py-1.5 md:top-3 ${className}`}>
      <ul className="mx-auto flex w-max items-stretch">
        {groups.map((group, i) => (
          <li key={i} className={`flex ${i > 0 ? 'ml-1.5 border-l border-rule pl-1.5' : ''}`}>
            <ul className="flex">
              {group.map((option) => {
                const selected = option.value === value;
                return (
                  <li key={option.value} className="relative w-[5.75rem]">
                    {selected && (
                      <motion.span
                        layoutId={layoutId}
                        transition={glide}
                        className="absolute inset-0 rounded-[11px] bg-[var(--g-selected)]"
                        aria-hidden="true"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => onChange(option.value)}
                      aria-current={selected ? 'page' : undefined}
                      className={`${item} ${selected ? 'font-semibold text-ink' : 'text-muted hover:bg-[var(--g-hover)] hover:text-ink'}`}
                    >
                      <span className="relative">
                        {renderIcon(option.value)}
                        {option.badge > 0 && (
                          <span className="absolute -top-1.5 -right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-spend px-1 text-[11px] font-semibold text-white tnum shadow-sm">
                            {option.badge}
                          </span>
                        )}
                      </span>
                      <span className="whitespace-nowrap">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {actions.length > 0 && (
          <li className="ml-1.5 flex border-l border-rule pl-1.5">
            <ul className="flex">
              {actions.map((a) => (
                <li key={a.key} className="relative w-[5.75rem]">
                  <button type="button" onClick={a.onClick} className={`${item} text-muted hover:bg-[var(--g-hover)] hover:text-ink`}>
                    {a.icon}
                    <span className="whitespace-nowrap">{a.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </nav>
  );
}
