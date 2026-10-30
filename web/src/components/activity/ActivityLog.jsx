import { useEffect, useState } from 'react';
import { PageTitle, Segmented, EmojiTile } from '../ui/Form';
import { GlassToolbar } from '../settings/glass-ui';
import { activityTone } from '../../lib/activity/activity-glyphs';
import { DataTable } from '../ui/DataTable';
import { api, formatTimestamp } from '../../api';
import { collapseRuns, describeAction, describeDetail, subjectOf } from '../../lib/activity/activity-format';
import { useDesign } from '../../hooks/use-design';
import { GlassActivity } from './GlassActivity';
import { ListSkeleton } from '../ui/Loading';

/**
 * Every write the app has ever made, newest first (audit_log). D142
 * turned the raw JSON column into plain language: each row says what
 * happened to what, and its ＋ opens exactly what changed, from → to.
 * All the wording lives in activity-format.js (pure, tested); this file
 * only lays it out.
 */

const AREAS = [
  { value: 'all', label: 'All' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'imports', label: 'Imports' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'setup', label: 'Setup' },
];

const PAGE = 100;

// Vivid (D395): the toolbar's filters and each row's tile in Vivid's palette, by the tone Glass's
// rows use (activity-glyphs.js), so a filter and the rows it leaves read as one colour.
const VIVID_AREAS = {
  all: { emoji: '📚', tint: 'bg-vivid-purple/15' },
  transactions: { emoji: '🧾', tint: 'bg-vivid-teal/15' },
  imports: { emoji: '📥', tint: 'bg-vivid-amber/20' },
  recurring: { emoji: '🔁', tint: 'bg-vivid-purple/15' },
  setup: { emoji: '⚙️', tint: 'bg-rule/60' },
  refresh: { emoji: '🔄', tint: 'bg-vivid-blue/15' },
};
const VIVID_TONE = {
  transactions: 'bg-vivid-teal/15', imports: 'bg-vivid-amber/20', recurring: 'bg-vivid-purple/15', merchants: 'bg-vivid-pink/15',
  money: 'bg-vivid-green/15', categories: 'bg-vivid-amber/20', people: 'bg-vivid-blue/15', system: 'bg-rule/60', alert: 'bg-vivid-red/15',
};

function NestedFacts({ value }) {
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-l-2 border-rule pl-3">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k.replace(/_/g, ' ')}</dt>
          <dd className="break-all font-mono text-ink/80">{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActivityDetail({ entry, lookup }) {
  const { changes, legacyFields, facts } = describeDetail(entry.detail, lookup);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {changes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {changes.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center gap-2">
              <span className="w-32 shrink-0 text-muted">{c.label}</span>
              <span className="rounded-md bg-spend/10 px-2 py-0.5 text-spend line-through decoration-spend/40">{c.from}</span>
              <span className="text-faint" aria-hidden="true">→</span>
              <span className="rounded-md bg-earn/10 px-2 py-0.5 font-medium text-earn">{c.to}</span>
            </li>
          ))}
        </ul>
      )}
      {legacyFields && (
        <p className="text-muted">
          Changed: <span className="text-ink">{legacyFields.join(', ')}</span>
          <span className="block text-xs text-faint">Before/after values weren't recorded for edits made before this view existed.</span>
        </p>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted">{f.label}</dt>
              <dd className="min-w-0 text-ink">{f.nested ? <NestedFacts value={f.nested} /> : f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-faint">
        Entry #{entry.id} · by {entry.actor}
        {subjectOf(entry).entity && ` · ${subjectOf(entry).entity}`}
      </p>
    </div>
  );
}

export function ActivityLog({ categories = [], accounts = [], people = [] }) {
  const { design } = useDesign();
  const glass = design === 'glass';
  const vivid = design === 'vivid';
  const [area, setArea] = useState('all');
  const [nonce, setNonce] = useState(0); // Refresh bumps it
  // Each response carries the request key it answered, so a slow answer
  // for a previous area can never overwrite the current one, and
  // "loading" is simply "the result on screen isn't for this key yet".
  const key = `${area}:${nonce}`;
  const [result, setResult] = useState({ key: null, entries: null, error: null, hasMore: false });
  const lookup = { categories, accounts, people };
  const areaParam = area === 'all' ? undefined : area;

  useEffect(() => {
    let cancelled = false;
    api
      .activity(PAGE, { area: areaParam })
      .then((rows) => !cancelled && setResult({ key, entries: rows, error: null, hasMore: rows.length === PAGE }))
      .catch((err) => !cancelled && setResult({ key, entries: null, error: err.message, hasMore: false }));
    return () => {
      cancelled = true;
    };
  }, [key, areaParam]);

  const current = result.key === key;
  const entries = current ? result.entries : null;
  const error = current ? result.error : null;

  const showMore = () =>
    api
      .activity(PAGE, { area: areaParam, before: entries.at(-1).id })
      .then((rows) =>
        setResult((prev) => (prev.key === key ? { ...prev, entries: [...prev.entries, ...rows], hasMore: rows.length === PAGE } : prev))
      )
      .catch((err) => setResult((prev) => ({ ...prev, error: err.message })));

  if (glass) {
    return (
      <GlassActivity
        areas={AREAS} area={area} setArea={setArea}
        entries={entries} error={error} hasMore={result.hasMore} showMore={showMore}
        refresh={() => setNonce((n) => n + 1)} lookup={lookup}
      />
    );
  }

  const columns = [
    {
      key: 'what',
      header: 'What happened',
      render: (e) => {
        const { emoji, label } = describeAction(e.action);
        const { name } = subjectOf(e);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-base leading-none ${vivid ? VIVID_TONE[activityTone(e.action)] : 'bg-band'}`} aria-hidden="true">
              {emoji}
            </span>
            <div className="min-w-0">
              <div className="text-ink">{label}{e.count > 1 && <span className="text-muted tnum"> · {e.count}</span>}</div>
              {name && <div className="max-w-md truncate text-xs text-muted">{name}</div>}
              {/* The When column is hidden on a phone (D232); the time rides here. */}
              <div className="font-mono text-xs tnum text-faint md:hidden">{formatTimestamp(e.created_at)}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'when',
      header: 'When',
      phone: false,
      className: 'whitespace-nowrap font-mono text-xs tnum text-muted',
      headerClassName: 'w-44',
      render: (e) => formatTimestamp(e.created_at),
    },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="📈" tint="bg-vivid-pink/15">
            Activity
          </PageTitle>
          <p className="mt-1 text-sm text-muted">Every change the app has made, newest first. Open one to see exactly what changed.</p>
        </div>
        {!vivid && (
          <div className="flex min-w-0 max-w-full items-center gap-3">
            <div className="min-w-0"><Segmented value={area} onChange={setArea} options={AREAS} /></div>
            <button onClick={() => setNonce((n) => n + 1)} className="shrink-0 text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Vivid: the filters as a centred toolbar under the title, as Glass has them (D395). */}
      {vivid && (
        <GlassToolbar
          className="mb-6"
          label="Activity filters"
          groups={[AREAS.slice(0, 1), AREAS.slice(1)]}
          value={area}
          onChange={setArea}
          renderIcon={(value) => <EmojiTile {...VIVID_AREAS[value]} size={28} />}
          layoutId="vivid-area-selection"
          actions={[{ key: 'refresh', label: 'Refresh', onClick: () => setNonce((n) => n + 1), icon: <EmojiTile {...VIVID_AREAS.refresh} size={28} /> }]}
        />
      )}

      {error && <p className="mb-4 text-sm text-spend">{error}</p>}
      {entries === null && !error && <ListSkeleton />}

      {entries && (
        <>
          <DataTable
            columns={columns}
            rows={collapseRuns(entries)}
            rowKey={(e) => e.id}
            renderDetail={(e) => <ActivityDetail entry={e} lookup={lookup} />}
            empty="Nothing recorded here yet."
          />
          {result.hasMore && (
            <div className="mt-4 text-center">
              <button onClick={showMore} className="rounded-lg border border-rule px-4 py-2 text-sm text-muted transition-colors hover:bg-band hover:text-ink">
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
