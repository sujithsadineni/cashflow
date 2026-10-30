import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { formatMoney, formatShortDate } from '../../api';
import { Button, EditableText } from '../ui/Form';
import { DatePicker } from '../ui/DatePicker';
import { FLAG_WORDS, daysApart, duplicateSides } from '../../lib/review/line-review';

/**
 * One statement line's panel in an upload's review (D335), opened from the
 * button at the end of its row. It says what's wrong in a sentence, shows
 * what's needed to decide (both sides of a possible duplicate, field by
 * field; the line as printed), and ends in the actions that settle it, as
 * real buttons: skip the line, keep it, tick it, or give it its date.
 *
 * It replaced a list of reasons and two underlined links (D323). A
 * duplicate showed only the other charge's date, so a person couldn't tell
 * it apart without leaving the review; and there was no way to say "yes,
 * it's the same", so the line stayed pending and Approve all let it in.
 */

const Glyph = ({ d, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const WARN_GLYPH = <><path d="M8 2.5 14.5 13.5h-13z" /><path d="M8 6.8v3M8 11.8v.01" /></>;
const PEN_GLYPH = <path d="M10.5 2.5l3 3L6 13H3v-3z" />;
const CLOSE_GLYPH = <path d="M4 4l8 8M12 4l-8 8" />;

const money = (c) => (c == null ? '—' : formatMoney(c, { showSign: true }));
const period = (s, e) => (s && e ? `${formatShortDate(s)} – ${formatShortDate(e)}, ${e.slice(0, 4)}` : null);

/** The end of a row: a quiet pencil when it reads cleanly, the one thing to look at when it doesn't. */
export function LineButton({ flags, skipped, open, label, onClick, onRestore }) {
  if (skipped) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted">
        <span className="hidden sm:inline">Skipped</span>
        <button type="button" onClick={onRestore} className="font-medium text-ink underline decoration-rule-str underline-offset-2 hover:decoration-ink">Undo</button>
      </span>
    );
  }
  if (flags.length === 0) {
    return (
      <button type="button" onClick={onClick} aria-expanded={open} aria-label={`Edit ${label}`} title="Edit"
        className={`inline-flex size-7 items-center justify-center rounded-full transition-colors hover:bg-band hover:text-ink ${open ? 'bg-band text-ink' : 'text-faint'}`}>
        <Glyph d={PEN_GLYPH} />
      </button>
    );
  }
  return (
    // On a phone the glyph alone (its word is in the label and under the name); the word beside it on wider screens.
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={`Review: ${flags.map((f) => FLAG_WORDS[f]).join(', ')}`} title={`Review: ${flags.map((f) => FLAG_WORDS[f]).join(', ')}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold text-warn transition-colors sm:px-2.5 sm:py-0.5 ${open ? 'bg-warn/20' : 'bg-warn/12 hover:bg-warn/20'}`}>
      <Glyph d={WARN_GLYPH} size={12} />
      <span className="hidden sm:inline">{FLAG_WORDS[flags[0]]}</span>
    </button>
  );
}

/** Both sides of a possible duplicate; what differs is in ink, the rest recedes. */
function Compare({ row, batchId }) {
  const sides = duplicateSides(row);
  const from = period(row.duplicate_period_start, row.duplicate_period_end);
  const savedNote = row.duplicate_batch_id === batchId ? 'Saved from this statement' : from ? `Saved from the ${from} statement` : 'In your transactions';
  const fields = [
    ['Date', sides.date, (v) => (v ? formatShortDate(v) : 'No date')],
    ['Merchant', sides.merchant, (v) => v ?? '—'],
    ['Printed as', sides.line, (v) => v ?? '—'],
    ['Amount', sides.amount, money],
  // "Printed as" only when a merchant name was read: otherwise it repeats the line above it.
  ].filter(([label]) => label !== 'Printed as' || sides.merchant.here !== sides.line.here || sides.merchant.saved !== sides.line.saved);
  const column = (title, note, side) => (
    <div className="min-w-0 rounded-lg border border-rule bg-raised px-3 py-2">
      <p className="text-xs font-medium text-ink">{title}</p>
      <p className="mb-1.5 truncate text-xs text-muted">{note}</p>
      <dl className="grid grid-cols-1 gap-1">
        {fields.map(([label, value, show]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-[13px]">
            <dt className="shrink-0 text-muted">{label}</dt>
            <dd className={`min-w-0 truncate text-right ${label === 'Amount' || label === 'Date' ? 'font-mono tnum' : ''} ${value.same ? 'text-muted' : 'font-medium text-ink'}`}
              title={String(show(value[side]))}>
              {show(value[side])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {column('On this statement', 'Waiting for review', 'here')}
      {column('Already saved', savedNote, 'saved')}
    </div>
  );
}

/** What the panel's heading says for its first flag. */
function heading(flag, row) {
  const apart = daysApart(row.posted_date, row.duplicate_posted_date);
  switch (flag) {
    case 'conflict':
      return ['This exact charge is already saved', 'Same card, date, amount and wording, so saving it again was refused. Two real purchases can look like this: two of the same coffee on one day.'];
    case 'duplicate':
      return ['This may already be saved',
        `A charge on the same card for the same amount ${apart === 0 ? 'on the same day' : `${apart} day${apart === 1 ? '' : 's'} apart`} is in your transactions. A charge that posts near the closing date can print on two statements.`];
    case 'unsure':
      return ["The reader wasn't sure about this line", "Check it against the line as printed below before saving it."];
    case 'no-date':
      return ['No date on this line', 'Pick the date from the statement to save it.'];
    default:
      return null;
  }
}

export function LineReview({ row, batchId, flags, pending, onClose, onSkip, onKeep, onSelect, onDate, onRename, busy }) {
  const reduceMotion = useReducedMotion();
  const [date, setDate] = useState(null);
  const first = flags[0];
  const [title, explain] = heading(first, row) ?? [null, null];
  const duplicate = first === 'duplicate' || first === 'conflict';
  const others = flags.slice(1).map((f) => heading(f, row)[0]);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      role="region" aria-label={title ?? 'Line details'}
      className={`relative rounded-xl border bg-band/50 p-4 text-sm ${first ? 'border-warn/35' : 'border-rule'}`}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <button type="button" onClick={onClose} aria-label="Close" className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full text-muted hover:bg-band hover:text-ink">
        <Glyph d={CLOSE_GLYPH} />
      </button>

      {title && (
        <div className="pr-8">
          <p className="flex items-center gap-1.5 font-medium text-ink"><span className="text-warn"><Glyph d={WARN_GLYPH} /></span>{title}</p>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted">{explain}</p>
          {others.length > 0 && <p className="mt-1 text-[13px] text-warn">Also: {others.join(' · ')}</p>}
        </div>
      )}

      {duplicate && row.duplicate_of_id != null ? <Compare row={row} batchId={batchId} /> : null}

      <div className={`grid grid-cols-1 gap-3 ${title ? 'mt-3' : 'pr-8'} sm:grid-cols-[minmax(0,1fr)_14rem]`}>
        <div className="min-w-0">
          <p className="text-xs text-muted">Printed on the statement</p>
          <p className="mt-1 overflow-x-auto rounded-lg border border-rule bg-raised px-3 py-2 font-mono text-xs whitespace-pre text-ink">
            {row.raw_text ?? row.description ?? '—'}
          </p>
        </div>
        {onRename && (
          <div className="min-w-0">
            <p className="text-xs text-muted">Merchant name</p>
            <div className="mt-1 rounded-lg border border-rule bg-raised px-3 py-1.5">
              <EditableText value={row.merchant} placeholder={row.description ?? '—'} onSave={onRename} className="block w-full truncate text-ink" />
            </div>
          </div>
        )}
      </div>

      {pending && flags.includes('no-date') && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink">Date</span>
          <div className="w-44"><DatePicker value={date} onChange={setDate} aria-label="Date of this line" /></div>
          <Button size="sm" onClick={() => onDate(date)} disabled={!date || busy}>Use this date</Button>
        </div>
      )}

      {pending && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {duplicate && <>
            <Button size="sm" onClick={onSkip} disabled={busy}>Skip it, it's the same</Button>
            <Button size="sm" variant="quiet" onClick={onKeep} disabled={busy}>Not the same, save it</Button>
          </>}
          {first === 'unsure' && <>
            <Button size="sm" onClick={onSelect} disabled={busy}>Looks right, tick it</Button>
            <Button size="sm" variant="quiet" onClick={onSkip} disabled={busy}>Skip this line</Button>
          </>}
          {first === 'no-date' && <Button size="sm" variant="quiet" onClick={onSkip} disabled={busy}>Skip this line</Button>}
          {!first && (
            <button type="button" onClick={onSkip} disabled={busy} className="text-[13px] text-muted underline decoration-rule-str underline-offset-2 hover:text-ink">
              Not a transaction? Skip this line
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
