import { forwardRef } from 'react';

/**
 * The floating-label field (D230): a soft, roomy button with its label
 * small above the value and a round icon on the left. With nothing chosen,
 * the icon says what the field is, on a quiet outlined circle; once set, it
 * shows the choice's own coloured icon and the field turns faintly green,
 * so what's filtered shows at a glance. Used by the Transactions filters
 * (Dropdown with `label`, DateRangePicker).
 */
export const FieldTrigger = forwardRef(function FieldTrigger(
  { label, value, placeholder, set, icon, iconColor, fieldIcon, tail, open, className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      data-set={set || undefined}
      className={`field-box group grid h-[3.375rem] w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-xl border px-3 text-left transition-colors focus-visible:outline-none ${
        open ? 'border-earn bg-raised ring-4 ring-earn/15'
          : `border-transparent hover:border-rule-str focus-visible:border-earn ${set ? 'bg-earn/[0.08]' : 'bg-band'}`
      } ${className}`}
    >
      {set && icon ? (
        <span className="row-span-2 flex size-7 items-center justify-center rounded-full text-white" style={{ backgroundColor: iconColor }} aria-hidden="true">{icon}</span>
      ) : (
        <span className="row-span-2 flex size-7 items-center justify-center rounded-full bg-raised text-muted ring-1 ring-rule ring-inset" aria-hidden="true">{fieldIcon}</span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="text-[0.6875rem] leading-tight text-muted">{label}</span>
        <span className={`truncate leading-snug ${set ? 'font-medium text-ink' : 'text-muted'}`}>{value || placeholder}</span>
      </span>
      <span className="flex items-center gap-1.5">
        {tail}
        <svg viewBox="0 0 16 16" className={`size-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
});
