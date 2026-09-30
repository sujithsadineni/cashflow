/**
 * The shared piece behind both statement calendars in the app: a
 * year stepper, a legend, and a 12-box Jan-Dec grid colored by
 * whether an account has a statement on file that month. Extracted
 * from `StatementCalendar.jsx` (the Cards page's per-account view)
 * so the Statements page's new per-account grid doesn't reimplement
 * the same three-state color logic a second time — only the caller's
 * data source and what a click does differ.
 *
 * Full month names, not abbreviations (Jan/Feb/...) — asked for
 * directly after seeing the abbreviated mockup. 3 columns (4 rows)
 * rather than the original 4x3, with larger tiles — also direct
 * feedback, once the Statements page had a centered column with room
 * to give each button more presence. Widened again a step later
 * (`max-w-sm` -> `max-w-3xl`) once a real screenshot showed most of
 * that column still sitting empty next to the grid.
 *
 * Each tile carries two lines, not one: the month name stays full
 * ("January"), and a small "Statement" caption underneath is what's
 * new — asked for directly ("change name to jan-statement"), read
 * here as "this button should say what it is, not just which month."
 * Kept the full name rather than reverting to "Jan" for it, since
 * that was itself a direct ask two steps ago; the caption adds the
 * word without undoing that one.
 *
 * Which states are actually clickable is the one thing callers do
 * differ on: the Cards page calendar sends you to /import from a
 * missing or upcoming tile (nothing to do on an uploaded one yet);
 * the Statements page grid opens the statement itself from an
 * uploaded tile instead, and has nowhere else to send a missing/
 * upcoming click since the upload form already lives on that same
 * page. `clickableStates` controls only the hover affordance
 * (pointer cursor, brighten-on-hover) — `onTileClick` always fires
 * either way, so a caller can still act on any state; this just
 * keeps the cursor from promising an action that doesn't exist.
 *
 * `disabled` is the Statements page's other need: before any account
 * is picked there's no "this month" fact to color the grid with at
 * all, so every tile goes neutral (the `faint` token, the same one
 * the design system already reserves for disabled/inactive text)
 * instead of showing real colors for whichever account happened to
 * load first. The Cards page never needs this — it always has an
 * account by the time this renders — so it just never passes it.
 *
 * `compact` is the Cards page's own need, the opposite direction from
 * the "bigger tiles" feedback above: that page sits the grid next to
 * a single-card carousel with much less vertical room than the
 * Statements deck has, so the grid there shouldn't tower over it.
 * Smaller padding, no "Statement" caption line, and month names
 * abbreviated to three letters — the abbreviation undoes the earlier
 * full-name decision, but that feedback was about THIS SAME grid at
 * its large size, where a tile has room to spell "September" out;
 * compact tiles are roughly a third that width, too narrow for it.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATE_BG = { uploaded: 'bg-earn', upcoming: 'bg-warn', missing: 'bg-spend' };

const STATE_LABEL = {
  uploaded: 'Statement on file',
  upcoming: 'Not due yet',
  missing: 'No statement uploaded',
};

function YearArrow({ direction, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Previous year' : 'Next year'}
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-rule
                 text-muted transition-colors hover:bg-band disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg width="7" height="11" viewBox="0 0 9 14" fill="none" aria-hidden="true"
           style={direction === 'right' ? { transform: 'scaleX(-1)' } : undefined}>
        <path d="M8 1L1.5 7L8 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function MonthStatusGrid({
  year,
  uploadedMonths,
  onPrevYear,
  onNextYear,
  canGoPrevYear,
  canGoNextYear,
  onTileClick,
  clickableStates = ['upcoming', 'missing'],
  disabled = false,
  compact = false,
}) {
  const now = new Date();
  const todayYM = now.getFullYear() * 12 + (now.getMonth() + 1);

  return (
    <div className="flex flex-col items-center">
      <div className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-muted ${
        compact ? 'mb-3 text-xs' : 'mb-5 text-sm'
      }`}>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-earn" /> Uploaded</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-warn" /> Not due yet</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-spend" /> Missing</span>
      </div>

      <div className={`flex items-center gap-3 ${compact ? 'mb-2' : 'mb-4'}`}>
        <YearArrow direction="left" onClick={onPrevYear} disabled={disabled || !canGoPrevYear} />
        <div className="w-12 text-center text-sm font-medium text-ink tnum">{year}</div>
        <YearArrow direction="right" onClick={onNextYear} disabled={disabled || !canGoNextYear} />
      </div>

      <div className={`grid grid-cols-3 ${compact ? 'w-full max-w-sm gap-3' : 'max-w-3xl gap-6'}`}>
        {MONTHS.map((label, i) => {
          const month = i + 1;
          const key = `${year}-${String(month).padStart(2, '0')}`;
          const state = uploadedMonths.has(key) ? 'uploaded' : todayYM <= year * 12 + month ? 'upcoming' : 'missing';
          const clickable = !disabled && clickableStates.includes(state);
          return (
            <button
              key={month}
              type="button"
              onClick={() => { if (!disabled) onTileClick?.(state, key); }}
              title={disabled ? undefined : `${label} ${year} — ${STATE_LABEL[state]}`}
              className={`flex flex-col items-center justify-center text-center transition-transform ${
                compact ? 'gap-0.5 rounded-lg px-3 py-4' : 'gap-1.5 rounded-xl px-4 py-8'
              } ${disabled ? 'bg-band text-faint' : `text-white ${STATE_BG[state]}`} ${
                clickable ? 'cursor-pointer hover:brightness-110' : ''
              }`}
            >
              <span className={`font-semibold tnum ${compact ? 'text-base' : 'text-lg'}`}>{compact ? label.slice(0, 3) : label}</span>
              {!compact && (
                <span className={`text-xs font-medium uppercase tracking-wide ${disabled ? 'text-faint' : 'text-white/75'}`}>
                  Statement
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
