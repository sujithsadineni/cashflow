import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { formatTimestamp } from '../../api';
import { describeAction, describeDetail, subjectOf } from '../../activity-format';
import { activityGlyph, dayLabel, AREA_GLYPHS } from '../../activity-glyphs';
import { ACTIVITY_GLYPHS } from '../../glass-activity-glyphs';
import { GroupSection, Group, Chevron, Tile, GlassToolbar } from '../settings/glass-ui';

/**
 * Glass Activity (D247), after Wallet's transaction list and Notification
 * Center: entries grouped under "Today", "Yesterday", "Monday, October 12",
 * each row a glyph on its area's colour, what happened, what it touched,
 * and the time. The whole row opens its detail; the chevron turns to say so.
 * The detail is an inset list of label … value, the way Settings shows
 * About. Data and wording are ActivityLog's and activity-format.js's.
 */

const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function groupByDay(entries) {
  const groups = [];
  for (const e of entries) {
    const label = dayLabel(new Date(e.created_at));
    if (groups.at(-1)?.label === label) groups.at(-1).entries.push(e);
    else groups.push({ label, entries: [e] });
  }
  return groups;
}

function ActivityGlyph({ action, size = 30 }) {
  const { icon, color } = activityGlyph(action);
  const glyph = Math.round(size * 0.6);
  return (
    <Tile color={color} size={size}>
      <svg width={glyph} height={glyph} viewBox="0 0 512 512">{ACTIVITY_GLYPHS[icon]}</svg>
    </Tile>
  );
}

/** A toolbar item's tile. `turns` spins the glyph a full turn per press (Refresh). */
function AreaTile({ icon, color, turns = 0 }) {
  return (
    <Tile color={color} size={28}>
      <motion.svg
        width="17" height="17" viewBox="0 0 512 512"
        animate={{ rotate: turns * 360 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.6 }}
      >
        {ACTIVITY_GLYPHS[icon]}
      </motion.svg>
    </Tile>
  );
}

/** One label … value line of the detail. */
function DetailRow({ label, children }) {
  return (
    <div className="gs-row flex items-baseline justify-between gap-6 px-3.5 py-2">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] break-words text-ink tnum">{children}</dd>
    </div>
  );
}

function GlassDetail({ entry, lookup }) {
  const { changes, legacyFields, facts } = describeDetail(entry.detail, lookup);
  const { entity } = subjectOf(entry);
  const hasRows = changes.length > 0 || facts.length > 0;

  return (
    <div className="space-y-2 pt-0.5 pr-4 pb-4 pl-[58px]">
      {hasRows && (
        <dl className="overflow-hidden rounded-[10px] bg-band" style={{ '--gs-inset': '14px' }}>
          {changes.map((c) => (
            <DetailRow key={`c-${c.label}`} label={c.label}>
              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                <span className="rounded-full bg-spend/10 px-2 py-0.5 text-spend line-through decoration-spend/40">{c.from}</span>
                <svg width="12" height="10" viewBox="0 0 12 10" aria-label="became" className="text-faint">
                  <path d="M1 5h9M6.5 1.5 10 5l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="rounded-full bg-earn/10 px-2 py-0.5 font-medium text-earn">{c.to}</span>
              </span>
            </DetailRow>
          ))}
          {facts.map((f) => (
            <DetailRow key={`f-${f.label}`} label={f.label}>
              {f.nested ? (
                <span className="flex flex-col items-end gap-0.5">
                  {Object.entries(f.nested).map(([k, v]) => (
                    <span key={k}>
                      <span className="text-muted">{k.replace(/_/g, ' ')}</span>{' '}
                      <span className="font-mono text-[12px]">{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</span>
                    </span>
                  ))}
                </span>
              ) : f.value}
            </DetailRow>
          ))}
        </dl>
      )}
      {legacyFields && (
        <p className="text-[13px] text-muted">
          Changed: <span className="text-ink">{legacyFields.join(', ')}</span>. Before and after weren't recorded for edits this old.
        </p>
      )}
      {!hasRows && !legacyFields && <p className="text-[13px] text-muted">Nothing else was recorded for this.</p>}
      <p className="px-1 text-[12px] text-faint">
        {formatTimestamp(entry.created_at)} · Entry #{entry.id} · by {entry.actor}{entity && ` · ${entity}`}
      </p>
    </div>
  );
}

function ActivityRow({ entry, lookup }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const { label } = describeAction(entry.action);
  const { name } = subjectOf(entry);

  return (
    <li className="gs-row">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="gs-row-action flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left"
      >
        <ActivityGlyph action={entry.action} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-snug text-ink">{label}</span>
          {name && <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted">{name}</span>}
        </span>
        <span className="shrink-0 text-[13px] text-muted tnum">{timeOf(entry.created_at)}</span>
        <Chevron open={open} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.35 }}
            className="overflow-hidden"
          >
            <GlassDetail entry={entry} lookup={lookup} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function GlassActivity({ areas, area, setArea, entries, error, hasMore, showMore, refresh, lookup }) {
  const reduceMotion = useReducedMotion();
  const [turns, setTurns] = useState(0);
  const groups = entries ? groupByDay(entries) : [];

  return (
    <div>
      <header className="mb-4">
        <h2 className="page-title">Activity</h2>
        <p className="mt-1 text-[13px] text-muted">Every change the app has made, newest first. Open one to see exactly what changed.</p>
      </header>

      {/* The filters as a Settings-window toolbar (D248), with Refresh as its last item. */}
      <GlassToolbar
        className="mb-7"
        label="Activity filters"
        groups={[areas.slice(0, 1), areas.slice(1)]}
        value={area}
        onChange={setArea}
        renderIcon={(value) => <AreaTile {...AREA_GLYPHS[value]} />}
        layoutId="ga-area-selection"
        actions={[{
          key: 'refresh',
          label: 'Refresh',
          onClick: () => { setTurns((t) => t + 1); refresh(); },
          icon: <AreaTile {...AREA_GLYPHS.refresh} turns={reduceMotion ? 0 : turns} />,
        }]}
      />

      {error && <p className="mb-4 px-4 text-[13px] text-spend">{error}</p>}
      {entries === null && !error && <p className="px-4 text-[13px] text-muted">Loading…</p>}
      {entries?.length === 0 && (
        <Group as="div" className="px-6 py-10 text-center text-[15px] text-muted">Nothing recorded here yet.</Group>
      )}

      <div className="space-y-7">
        {groups.map((g) => (
          <GroupSection key={g.label} label={`${g.label} · ${g.entries.length}`}>
            <Group inset={58}>
              {g.entries.map((e) => <ActivityRow key={e.id} entry={e} lookup={lookup} />)}
            </Group>
          </GroupSection>
        ))}
      </div>

      {hasMore && (
        <button type="button" onClick={showMore} className="mt-4 w-full rounded-[14px] py-2.5 text-[15px] font-medium text-info transition-colors hover:bg-[var(--g-hover)]">
          Show More
        </button>
      )}
    </div>
  );
}
