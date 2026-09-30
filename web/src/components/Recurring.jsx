import { useState } from 'react';
import { api, formatMoney, formatShortDate } from '../api';
import { Field, TextInput, Select, Button, PageTitle } from './Form';
import { RecurringCalendar } from './RecurringCalendar';
import { motion } from 'motion/react';
import { useDesign } from '../design-context';
import { RecurringIcon } from './RecurringIcon';
import { lookupMerchantDomain } from '../merchant-logos';

/**
 * Recurring expenses: detection proposes, you confirm. "Review
 * detected" runs the classifier (api/src/recurring.js) against real
 * history and shows each candidate with the actual transactions that
 * produced it — confidence alone isn't trustworthy enough to act on
 * without seeing the evidence. Confirming one both saves the rule and
 * retroactively tags those transactions; nothing is written until you
 * confirm.
 */


const CADENCE_UNIT = { WEEKLY: 'week', BIWEEKLY: '2 weeks', MONTHLY: 'month', QUARTERLY: 'quarter', ANNUAL: 'year' };
const cadenceLabel = (cadence, interval) => {
  const unit = CADENCE_UNIT[cadence] ?? cadence.toLowerCase();
  if (interval === 1) return unit === '2 weeks' ? 'Every 2 weeks' : `Every ${unit}`;
  return `Every ${interval} ${unit}s`;
};

// A small fixed set the user picks from rather than an arbitrary color
// legend to learn — the same glyph shows up on the Calendar view later.
const GLYPHS = ['🎬', '🏠', '⚡', '📱', '🛡', '🚗', '💪', '☁️', '💳', '🎮', '📰', '🍽'];

function GlyphPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {GLYPHS.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          className={`flex size-9 items-center justify-center rounded-md border text-lg transition-colors ${
            value === g ? 'border-ink bg-band' : 'border-rule hover:bg-band/60'
          }`}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------
   Review detected — candidates only, nothing saved until Confirm
   ------------------------------------------------------------------ */

function CandidateCard({ candidate, categories, onConfirm, onDismiss }) {
  const [name, setName] = useState(candidate.suggested_name);
  const [glyph, setGlyph] = useState(GLYPHS[0]);
  const [categoryId, setCategoryId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const evidence = expanded ? candidate.evidence : candidate.evidence.slice(-3);
  // A real merchant logo is the requirement, not the emoji picker —
  // the picker only shows up as the fallback when there's no
  // confident logo to use, same as MerchantAvatar's own rule.
  const hasLogo = Boolean(lookupMerchantDomain(candidate.merchant));

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(candidate, { name: name.trim() || candidate.suggested_name, glyph, category_id: categoryId || null });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function dismiss() {
    setSaving(true);
    setError(null);
    try {
      await onDismiss(candidate);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-rule bg-raised p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {hasLogo ? (
            <RecurringIcon name={candidate.merchant} glyph={glyph} size={36} />
          ) : (
            <GlyphPicker value={glyph} onChange={setGlyph} />
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm text-spend tnum">{formatMoney(candidate.expected_amount_cents)}</div>
          <div className="text-sm text-faint">{cadenceLabel(candidate.cadence, candidate.cadence_interval)}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Category" hint="Optional">
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[{ value: '', label: '— none —' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        <span className={candidate.confidence === 'HIGH' ? 'font-medium text-ink' : ''}>{candidate.confidence} confidence</span>
        <span>·</span>
        <span>seen {candidate.occurrence_count} times</span>
        <span>·</span>
        <span>next {formatShortDate(candidate.next_expected_date)}</span>
        {candidate.amount_varies && (
          <>
            <span>·</span>
            <span>amount varies</span>
          </>
        )}
      </div>

      <div className="mt-3 border-t border-rule pt-3">
        <ul className="space-y-1 text-sm">
          {evidence.map((t) => (
            <li key={t.id} className="flex justify-between text-muted">
              <span className="truncate">{formatShortDate(t.posted_date)} · {t.description}</span>
              <span className="ml-3 shrink-0 font-mono text-spend tnum">{formatMoney(t.amount_cents)}</span>
            </li>
          ))}
        </ul>
        {candidate.evidence.length > 3 && (
          <button onClick={() => setExpanded(!expanded)} className="mt-1.5 text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
            {expanded ? 'Show fewer' : `Show all ${candidate.evidence.length}`}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-spend">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={confirm} disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</Button>
        <Button variant="quiet" onClick={dismiss} disabled={saving}>Dismiss</Button>
      </div>
    </div>
  );
}

function ReviewDetected({ categories, onConfirmed }) {
  const [candidates, setCandidates] = useState(null); // null = not run yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setCandidates(await api.recurring.detect());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirm(candidate, { name, glyph, category_id }) {
    await api.recurring.create({
      name,
      glyph,
      category_id,
      match_name_contains: candidate.match_name_contains,
      match_amount_min_cents: candidate.match_amount_min_cents,
      match_amount_max_cents: candidate.match_amount_max_cents,
      match_days_of_month: candidate.match_days_of_month,
      cadence: candidate.cadence,
      cadence_interval: candidate.cadence_interval,
      expected_amount_cents: candidate.expected_amount_cents,
      amount_varies: candidate.amount_varies,
      status: 'ACTIVE',
      next_expected_date: candidate.next_expected_date,
      confidence: candidate.confidence,
      created_from: 'DETECTED',
    });
    setCandidates((prev) => prev.filter((c) => c !== candidate));
    onConfirmed();
  }

  async function dismiss(candidate) {
    // Persisted (db/023_dismissed_recurring_candidate.sql), not just a
    // client-side filter — the old version of this only hid the card
    // in memory, so it came right back on the next refresh or re-run.
    await api.recurring.dismissCandidate(candidate.match_name_contains);
    setCandidates((prev) => prev.filter((c) => c !== candidate));
  }

  if (candidates === null) {
    return (
      <div className="mb-8 rounded-2xl border border-dashed border-rule-str px-5 py-6 text-center">
        <p className="text-sm text-muted">Look for subscriptions, rent, and bills in your transaction history.</p>
        {error && <p className="mt-2 text-sm text-spend">{error}</p>}
        <Button onClick={run} variant="quiet" disabled={loading}>
          {loading ? 'Looking…' : 'Review detected'}
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-ink">
          {candidates.length === 0 ? 'Nothing left to review' : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`}
        </h3>
        <button onClick={() => setCandidates(null)} className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
          Close
        </button>
      </div>
      <div className="space-y-3">
        {candidates.map((c) => (
          <CandidateCard key={`${c.merchant}-${c.expected_amount_cents}`} candidate={c} categories={categories} onConfirm={confirm} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Saved series — grouped list
   ------------------------------------------------------------------ */

function bucketOf(series) {
  if (series.status === 'ENDED' || series.lapsed) return 'Ended';
  if (series.status === 'PAUSED') return 'Paused';
  if (!series.next_expected_date) return 'Later';

  const now = new Date();
  const [y, m] = series.next_expected_date.split('-').map(Number);
  const dueThisMonth = y === now.getFullYear() && m === now.getMonth() + 1;
  return dueThisMonth ? 'Due this month' : 'Later';
}

const BUCKET_ORDER = ['Due this month', 'Later', 'Paused', 'Ended'];

const actionIconProps = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
const actionStrokeProps = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

function PauseIcon() {
  return (
    <svg {...actionIconProps}>
      <path d="M5.5 4v8M10.5 4v8" {...actionStrokeProps} />
    </svg>
  );
}
function ResumeIcon() {
  return (
    <svg {...actionIconProps}>
      <path d="M5 3.5l7 4.5-7 4.5v-9z" {...actionStrokeProps} strokeLinejoin="round" />
    </svg>
  );
}
function EndIcon() {
  return (
    <svg {...actionIconProps}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" {...actionStrokeProps} />
    </svg>
  );
}

/** A small icon button for a card's Pause/Resume/End actions — a
 * title attribute carries the label instead of visible text, so three
 * of these read as a quiet action row rather than a button toolbar. */
function ActionButton({ label, onClick, disabled, children }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-band hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// Vivid (D143): each group gets an emoji and a color, so "due this
// month" reads apart from "later" before a single name is read.
const BUCKET_VIVID = {
  'Due this month': { emoji: '📅', tint: 'bg-vivid-amber/10', bar: 'bg-vivid-amber' },
  Later: { emoji: '🗓️', tint: 'bg-vivid-blue/10', bar: 'bg-vivid-blue' },
  Paused: { emoji: '⏸️', tint: 'bg-band', bar: 'bg-rule-str' },
  Ended: { emoji: '🏁', tint: 'bg-band', bar: 'bg-rule-str' },
};

/**
 * "in 9 days" / "today" / "21 days overdue" for a series' next date,
 * against local today. Past-due only counts as overdue for an ACTIVE
 * series — a paused one's old date is just history ("22 days ago").
 */
function dueIn(series) {
  if (!series.next_expected_date) return null;
  const [y, m, d] = series.next_expected_date.split('-').map(Number);
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  const n = Math.abs(days);
  const plural = `${n} day${n === 1 ? '' : 's'}`;
  if (days === 0) return { text: 'due today', overdue: false };
  if (days > 0) return { text: `in ${plural}`, overdue: false };
  return series.status === 'ACTIVE' ? { text: `${plural} overdue`, overdue: true } : { text: `${plural} ago`, overdue: false };
}

function SeriesCard({ series, onChange }) {
  const [busy, setBusy] = useState(false);
  const { design } = useDesign();

  async function setStatus(status) {
    setBusy(true);
    try {
      await api.recurring.update(series.id, { status });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <div className="flex shrink-0 items-center gap-1">
      {series.status === 'PAUSED' || series.status === 'ENDED' ? (
        <ActionButton label="Resume" disabled={busy} onClick={() => setStatus('ACTIVE')}><ResumeIcon /></ActionButton>
      ) : series.status === 'ACTIVE' && !series.lapsed ? (
        <ActionButton label="Pause" disabled={busy} onClick={() => setStatus('PAUSED')}><PauseIcon /></ActionButton>
      ) : null}
      {series.status !== 'ENDED' && (
        <ActionButton label="End" disabled={busy} onClick={() => setStatus('ENDED')}><EndIcon /></ActionButton>
      )}
    </div>
  );

  if (design === 'vivid') {
    const b = BUCKET_VIVID[bucketOf(series)];
    const when = dueIn(series);
    return (
      <motion.div
        whileHover={{ y: -3 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="relative flex flex-col overflow-hidden rounded-2xl border border-rule bg-raised p-4 shadow-sm transition-shadow hover:shadow-md"
      >
        <span className={`absolute inset-x-0 top-0 h-1 ${b.bar}`} />
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${b.tint}`}>
            <RecurringIcon name={series.name} glyph={series.glyph} size={26} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{series.name}</div>
            <div className="truncate text-xs text-muted">
              {cadenceLabel(series.cadence, series.cadence_interval)} · seen {series.occurrence_count}×
              {series.account_name ? ` · ${series.account_name}` : ''}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-2">
          <div>
            <div className="font-mono text-lg font-semibold text-spend tnum">{formatMoney(series.expected_amount_cents)}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted tnum">
              next {formatShortDate(series.next_expected_date)}
              {when && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                    when.overdue ? 'bg-vivid-red/10 font-medium text-vivid-loss' : `text-ink ${b.tint}`
                  }`}
                >
                  {when.overdue && '⚠️ '}
                  {when.text}
                </span>
              )}
            </div>
          </div>
          {actions}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-rule bg-raised p-4">
      <div className="flex min-w-0 items-center gap-3">
        <RecurringIcon name={series.name} glyph={series.glyph} size={28} />
        <div className="min-w-0">
          <div className="truncate text-ink">{series.name}</div>
          <div className="truncate text-sm text-muted">
            {cadenceLabel(series.cadence, series.cadence_interval)} · seen {series.occurrence_count}×
            {series.account_name ? ` · ${series.account_name}` : ''}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2 border-t border-rule pt-3">
        <div>
          <div className="font-mono text-sm text-spend tnum">{formatMoney(series.expected_amount_cents)}</div>
          <div className="text-sm text-faint tnum">next {formatShortDate(series.next_expected_date)}</div>
        </div>
        {actions}
      </div>
    </div>
  );
}

export function Recurring({ categories }) {
  const vivid = useDesign().design === 'vivid';
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);
  const [includeEnded, setIncludeEnded] = useState(false);

  const load = async () => {
    try {
      setSeries(await api.recurring.list(includeEnded));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  if (series === null && !error) load();

  const buckets = new Map(BUCKET_ORDER.map((b) => [b, []]));
  for (const s of series ?? []) buckets.get(bucketOf(s))?.push(s);

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between border-b border-rule pb-2">
        <PageTitle className="text-base font-medium text-ink" emoji="🔁" tint="bg-vivid-purple/15">Recurring</PageTitle>
      </div>

      {error && <p className="mb-4 text-sm text-spend">{error}</p>}

      <ReviewDetected categories={categories} onConfirmed={load} />

      {series !== null && (
        <div className="mb-10">
          <RecurringCalendar series={series} />
        </div>
      )}

      {series?.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-rule-str px-5 py-10 text-center">
          <p className="text-ink">No recurring expenses confirmed yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
            Use "Review detected" above to find subscriptions and bills in your transaction history.
          </p>
        </div>
      ) : (
        BUCKET_ORDER.map((bucket) => {
          const rows = buckets.get(bucket);
          if (!rows || rows.length === 0) return null;
          return (
            <div key={bucket} className="mb-8">
              <h3 className="mb-3 text-sm font-medium text-muted">
                {vivid && <span aria-hidden="true">{BUCKET_VIVID[bucket].emoji} </span>}
                {bucket}
                {vivid && <span className="ml-1.5 rounded-full bg-band px-1.5 text-xs tnum">{rows.length}</span>}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((s) => <SeriesCard key={s.id} series={s} onChange={load} />)}
              </div>
            </div>
          );
        })
      )}

      {series !== null && series.length > 0 && (
        <button
          onClick={() => { setIncludeEnded(!includeEnded); setSeries(null); }}
          className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {includeEnded ? 'Hide ended' : 'Show ended'}
        </button>
      )}
    </section>
  );
}
