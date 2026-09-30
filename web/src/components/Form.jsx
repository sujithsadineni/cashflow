/**
 * Form primitives.
 *
 * Kept deliberately plain: a label, a control, and space for an
 * error message. No component library yet — these are the only
 * three shapes the app currently needs, and pulling in a kit before
 * you know what you need just imports someone else's opinions.
 */

import { useState } from 'react';
import { useDesign } from '../design-context';

const controlClasses =
  'w-full rounded-md border border-rule bg-raised px-3 py-2 text-ink ' +
  'placeholder:text-faint transition-colors focus:border-earn focus:outline-none';

export function Field({ label, error, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-spend">{error}</span>}
      {hint && !error && <span className="mt-1 block text-sm text-faint">{hint}</span>}
    </label>
  );
}

export function TextInput({ invalid, type = 'text', ...props }) {
  return (
    <input
      type={type}
      className={`${controlClasses} ${invalid ? 'border-spend' : ''}`}
      {...props}
    />
  );
}

export function TextArea({ invalid, rows = 5, ...props }) {
  return <textarea rows={rows} className={`${controlClasses} resize-y ${invalid ? 'border-spend' : ''}`} {...props} />;
}

export function Select({ options, invalid, ...props }) {
  return (
    <select className={`${controlClasses} ${invalid ? 'border-spend' : ''}`} {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Click-to-edit text, inline: reads as plain text until clicked, then
 * becomes a text field. Enter or blur saves; Escape cancels. Used for
 * merchant names in both the review screen and the permanent ledger.
 */
export function EditableText({ value, onSave, placeholder, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value ?? ''); setEditing(true); }}
        className={`-mx-1 rounded px-1 text-left transition-colors hover:bg-band ${className}`}
        title="Click to rename"
      >
        {value ?? <span className="text-faint">{placeholder ?? '—'}</span>}
      </button>
    );
  }

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
  };

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-full rounded-md border border-earn bg-raised px-1.5 py-0.5 text-sm text-ink focus:outline-none"
    />
  );
}

// The active pill's look per `tone`. `info`/`accent2` are the design
// system's own "informational accent" pair — already reserved in
// index.css for exactly this: a dashboard concept that's neither
// money-out nor money-in, kept muted rather than a fully saturated
// fill so it doesn't compete with spend/earn for that meaning.
const SEGMENTED_TONES = {
  neutral: 'border-rule bg-raised text-ink',
  info: 'border-info/30 bg-info/10 text-info',
  accent2: 'border-accent2/30 bg-accent2/10 text-accent2',
  // spend/earn reused at their real meaning (money out/in) for a
  // control like the Zelle review's Sent/Received picker, not a new
  // accent — warn is the existing "status" token doing the same job
  // for a third state (Internal) that's neither.
  spend: 'border-spend/30 bg-spend/10 text-spend',
  earn: 'border-earn/30 bg-earn/10 text-earn',
  warn: 'border-warn/30 bg-warn/10 text-warn',
};

/**
 * Apple-style segmented control, in greenbar clothes. `size="lg"` is a
 * bigger variant and `tone` a colored active state, both used by a
 * page that's asked for them (the Statements/Cards filters) — the
 * defaults stay as-is for Overview's own pickers, which never asked
 * to change. An option can carry its own `tone` (e.g. Sent=spend,
 * Received=earn, Internal=warn, all in one control) — falls back to
 * the control-level `tone` when it doesn't, so every existing caller
 * with one shared color keeps working unchanged.
 */
// Vivid (D141): the same tones, in the Vivid palette — neutral picks
// up Vivid green so every page's toggles share the new accent.
const VIVID_SEGMENTED_TONES = {
  neutral: 'border-vivid-green/30 bg-raised text-vivid-green shadow-sm',
  info: 'border-vivid-teal/30 bg-vivid-teal/10 text-vivid-teal',
  accent2: 'border-vivid-purple/30 bg-vivid-purple/10 text-vivid-purple',
  spend: 'border-vivid-red/30 bg-vivid-red/10 text-vivid-loss',
  earn: 'border-vivid-green/30 bg-vivid-green/10 text-vivid-green',
  warn: 'border-vivid-amber/40 bg-vivid-amber/15 text-ink',
};

export function Segmented({ value, onChange, options, size = 'md', tone = 'neutral' }) {
  const { design } = useDesign();
  const tones = design === 'vivid' ? VIVID_SEGMENTED_TONES : SEGMENTED_TONES;
  const outerPad = size === 'lg' ? 'p-1' : 'p-0.5';
  const btnPad = size === 'lg' ? 'px-4 py-1.5 text-[0.95rem]' : 'px-3 py-1 text-sm';

  return (
    <div className={`inline-flex rounded-lg border border-rule bg-band ${outerPad}`}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md border font-medium transition-colors ${btnPad} ${
            value === option.value
              ? tones[option.tone ?? tone]
              : 'border-transparent font-normal text-muted hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ variant = 'primary', size = 'md', children, ...props }) {
  const { design } = useDesign();
  const primary = design === 'vivid'
    ? 'bg-vivid-green text-white shadow-sm hover:bg-vivid-green/90 active:scale-[0.98] disabled:bg-faint'
    : 'bg-ink text-paper hover:bg-ink/90 disabled:bg-faint';
  const styles = {
    primary,
    quiet: 'border border-rule text-ink hover:bg-band',
  }[variant];
  const padding = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2';

  return (
    <button
      className={`rounded-md font-medium transition-colors disabled:cursor-not-allowed ${padding} ${styles}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A page's title. Classic renders exactly the markup each page always
 * had (`as` + `className` pass straight through), so nothing about
 * Classic moves. Vivid (D141) gives every page the same treatment: its
 * sidebar emoji in a tinted tile beside a consistent 2xl title — the
 * emoji and tint match that page's own nav item, so the page reads as
 * the place the sidebar just took you.
 */
export function PageTitle({ as: Tag = 'h2', className, emoji, tint, children }) {
  const { design } = useDesign();
  if (design !== 'vivid' || !emoji) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag className="flex items-center gap-3 text-2xl font-medium tracking-tight text-ink">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-xl leading-none ${tint}`} aria-hidden="true">
        {emoji}
      </span>
      {children}
    </Tag>
  );
}

/**
 * A settings section's header (D147) — the same "title, anything on the
 * right" row eight sections each hand-wrote. Classic renders that
 * exact row (rule underneath); Vivid swaps the rule for the section's
 * emoji in a tinted tile, same language as PageTitle and the sidebar.
 */
export function SectionHeader({ as: Tag = 'h3', title, emoji, tint = 'bg-band', children }) {
  const { design } = useDesign();
  if (design !== 'vivid') {
    return (
      <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-2">
        <Tag className="text-base font-medium text-ink">{title}</Tag>
        {children}
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Tag className="flex items-center gap-2.5 text-lg font-medium text-ink">
        <span className={`flex size-9 items-center justify-center rounded-xl text-lg leading-none ${tint}`} aria-hidden="true">
          {emoji}
        </span>
        {title}
      </Tag>
      {children}
    </div>
  );
}
