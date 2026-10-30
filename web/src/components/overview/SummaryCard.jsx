import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useDesign } from '../../hooks/use-design';

/* ------------------------------------------------------------------
   Summary cards — an icon badge plus a top accent bar (style "B" from
   the owner's own comparison of four options), same treatment on all
   four cards now. A `to` navigates on click (used by Loans, which has
   no drill-down page yet — clicking it goes to where loans are
   actually managed).
   ------------------------------------------------------------------ */

// The nine card icons live in CardIcons.jsx, animated per part with
// the `motion` library (D138) — see SummaryCard for how a card's hover
// reaches them.

// Tailwind needs every class name it generates CSS for to appear as a
// literal string somewhere in the source — `bg-${tone}` at runtime
// would silently generate nothing. This map is what keeps the tone
// prop dynamic while every actual class stays a static, scannable
// string.
const TONE = {
  earn: { text: 'text-earn', bg: 'bg-earn' },
  spend: { text: 'text-spend', bg: 'bg-spend' },
  ink: { text: 'text-ink', bg: 'bg-rule-str' },
};

// Compact cards (the secondary row) are a different SHAPE, not just
// a smaller copy of the main one — label+icon on the left, the
// number on the right, on one row. The main card's layout (icon+
// label, then a big number below, then a caption) wastes most of a
// wide card's width on a short label and a small value; putting them
// side by side uses that space instead of leaving it empty, and lets
// the whole card sit shorter — asked for directly from a screenshot
// showing exactly that empty space.
function CompactSummaryCard({ label, value, text, bg, caption, icon, animated }) {
  return (
    <div
      className={`@container relative flex h-full flex-col justify-center overflow-hidden rounded-xl border border-rule bg-raised p-3 transition-all ${
        animated ? 'group-hover:-translate-y-0.5 group-hover:border-rule-str group-hover:shadow-md' : ''
      }`}
    >
      {icon && <div className={`accent-bar absolute inset-x-0 top-0 h-[3px] ${bg}`} />}
      {icon && animated && <div className={`card-sweep ${text}`} />}
      {/* Too narrow for label and number side by side (six across at 1440px), the number drops under the label. */}
      <div className="relative flex flex-col gap-1 @[12rem]:flex-row @[12rem]:items-start @[12rem]:justify-between @[12rem]:gap-3">
        <div className="flex min-w-0 items-start gap-1.5 text-xs leading-tight text-muted">
          {icon && (
            <span
              className={`card-icon mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-band ${text} ${
                animated ? 'icon-spark transition-transform duration-300 group-hover:scale-110' : ''
              }`}
            >
              {icon}
            </span>
          )}
          <span>{label}</span>
        </div>
        <div className="shrink-0 @[12rem]:text-right">
          <div className={`whitespace-nowrap font-mono text-base font-semibold tnum ${text}`}>{value}</div>
          {caption && <div className="mt-0.5 max-w-[9.5rem] truncate text-[10px] text-faint @[12rem]:ml-auto">{caption}</div>}
        </div>
      </div>
    </div>
  );
}

// Vivid (Settings → Design): each card gets its own identity color
// (`accent`) for a solid icon tile, independent of which way its money
// points — `tone` still decides the number's color. Static class
// strings for the same reason as TONE above.
const VIVID_ACCENT = {
  green: { tile: 'bg-vivid-green', soft: 'bg-vivid-green/10' },
  red: { tile: 'bg-vivid-red', soft: 'bg-vivid-red/10' },
  amber: { tile: 'bg-vivid-amber', soft: 'bg-vivid-amber/10' },
  teal: { tile: 'bg-vivid-teal', soft: 'bg-vivid-teal/10' },
  blue: { tile: 'bg-vivid-blue', soft: 'bg-vivid-blue/10' },
  purple: { tile: 'bg-vivid-purple', soft: 'bg-vivid-purple/10' },
  pink: { tile: 'bg-vivid-pink', soft: 'bg-vivid-pink/10' },
};
const VIVID_TONE = { earn: 'text-vivid-green', spend: 'text-vivid-loss', ink: 'text-ink' };

function VividSummaryCard({ label, value, tone, caption, icon, accent, compact }) {
  const { tile, soft } = VIVID_ACCENT[accent] ?? VIVID_ACCENT.green;
  const numberText = VIVID_TONE[tone];

  if (compact) {
    return (
      <div className={`@container flex h-full flex-col justify-center rounded-xl p-3 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md ${soft}`}>
        {/* Narrow, the number drops under the label, as in Classic's compact card. */}
        <div className="flex flex-col gap-1.5 @[12rem]:flex-row @[12rem]:items-center @[12rem]:justify-between @[12rem]:gap-3">
          <div className="flex min-w-0 items-center gap-2.5 text-xs leading-tight text-ink/80">
            {icon && (
              <span className={`vivid-tile inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white ${tile}`}>
                {icon}
              </span>
            )}
            <span>{label}</span>
          </div>
          <div className="shrink-0 @[12rem]:text-right">
            <div className={`whitespace-nowrap font-mono text-base font-semibold tnum ${numberText}`}>{value}</div>
            {caption && <div className="mt-0.5 max-w-[9.5rem] truncate text-[10px] text-muted @[12rem]:ml-auto">{caption}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3.5 rounded-2xl border border-rule bg-raised p-4 transition-all group-hover:-translate-y-0.5 group-hover:border-rule-str group-hover:shadow-md">
      {icon && (
        <span className={`vivid-tile inline-flex size-11 shrink-0 items-center justify-center rounded-[13px] text-white [&>svg]:size-5 ${tile}`}>
          {icon}
        </span>
      )}
      {/* The number never wraps (a "−" is a line-break opportunity, so a
          long spend split into "−" / "$1,234.56"), and scales with the
          card's own width instead (cqi) so a long figure still fits. */}
      <div className="@container min-w-0 flex-1">
        <div className="text-sm text-muted">{label}</div>
        <div className={`whitespace-nowrap font-mono text-[clamp(1.125rem,11.5cqi,1.5rem)] font-semibold tracking-tight tnum ${numberText}`}>{value}</div>
        {caption && <div className="mt-0.5 truncate text-xs text-faint">{caption}</div>}
      </div>
    </div>
  );
}

const MotionLink = motion.create(Link);

// Hovering (or keyboard-focusing) anywhere on a card sets it to its
// "hover" variant; motion passes that label down to every child with
// matching `variants`, which is how the icons in CardIcons.jsx know to
// animate without SummaryCard knowing anything about them.
const cardHover = { initial: 'rest', animate: 'rest', whileHover: 'hover', whileFocus: 'hover' };

export function SummaryCard({ label, value, tone = 'ink', caption, to, onClick, icon, animated = false, compact = false, accent }) {
  const { design } = useDesign();
  const { text, bg } = TONE[tone];
  const body = design === 'vivid' ? (
    <VividSummaryCard label={label} value={value} tone={tone} caption={caption} icon={icon} accent={accent} compact={compact} />
  ) : compact ? (
    <CompactSummaryCard label={label} value={value} text={text} bg={bg} caption={caption} icon={icon} animated={animated} />
  ) : (
    <div
      className={`relative h-full overflow-hidden rounded-2xl border border-rule bg-raised px-5 py-4 transition-all ${
        animated ? 'group-hover:-translate-y-0.5 group-hover:border-rule-str group-hover:shadow-md' : ''
      }`}
    >
      {icon && <div className={`accent-bar absolute inset-x-0 top-0 h-[3px] ${bg}`} />}
      {icon && animated && <div className={`card-sweep ${text}`} />}
      <div className="relative">
        <div className="flex items-center gap-2 text-sm text-muted">
          {icon && (
            <span
              className={`card-icon inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-band ${text} ${
                animated ? 'icon-spark transition-transform duration-300 group-hover:scale-110' : ''
              }`}
            >
              {icon}
            </span>
          )}
          {label}
        </div>
        <div className={`mt-1 whitespace-nowrap font-mono text-2xl font-semibold tracking-tight tnum ${text}`}>
          {value}
        </div>
        {caption && <div className="mt-1 truncate text-xs text-faint">{caption}</div>}
      </div>
    </div>
  );

  if (to) {
    return (
      <MotionLink to={to} className="group block h-full" {...cardHover}>
        {body}
      </MotionLink>
    );
  }
  if (onClick) {
    return (
      <motion.button onClick={onClick} className="group block h-full w-full text-left" {...cardHover}>
        {body}
      </motion.button>
    );
  }
  return (
    <motion.div className="h-full" {...cardHover}>
      {body}
    </motion.div>
  );
}
