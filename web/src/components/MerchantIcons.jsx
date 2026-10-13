import { useEffect, useMemo, useState } from 'react';
import { useDesign } from '../use-design';
import { ShowMore } from './ui/DetailDialog';
import { api, TXN_TYPE_LABELS } from '../api';
import { lookupMerchantDomain } from '../merchant-logos';
import { useMerchantIconsRefresh } from '../use-merchant-icons';
import { MerchantAvatar } from './MerchantAvatar';
import { TextInput, Segmented, SectionHeader } from './Form';
import { useNotify } from '../use-notify';
import { GroupSection, Group, Chevron } from './settings/glass-ui';
import { useWide, halves } from '../use-wide';

/**
 * The gap audit, made browsable and fixable. A real audit found 201
 * of 235 distinct merchants render with no icon — this page shows
 * every merchant that's ever appeared, filterable by whether it
 * already has one, so the actual gap (small/local businesses, plus
 * any known chain whose favicon load silently fails, e.g. behind an
 * ad blocker) is what's in front of you by default rather than
 * buried in a full A-Z list.
 *
 * A broader emoji set than Recurring's 12 — that picker only needed
 * to cover subscription categories (streaming, utilities, ...);
 * this one needs to span whatever the real merchant list actually
 * contains (food, retail, gas, beauty, services, travel, ...).
 */
const EMOJIS = [
  '🍽️', '🍕', '🍔', '🌮', '🍜', '🍛', '🍱', '🍦', '🧋', '☕', '🍩', '🥐',
  '🍺', '🍷', '🛒', '🛍️', '👗', '👟', '💄', '💅', '💇', '🧴', '🏋️', '🎬',
  '🎮', '📱', '💻', '⛽', '🚗', '🚕', '🅿️', '✈️', '🏨', '🏦', '💳', '💊',
  '🐾', '🌳', '🎓', '🏥', '🎳', '🧹', '📦', '🎁', '🕌', '⚓', '🛁', '💰',
];

function EmojiPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onChange(e)}
          className={`flex size-9 items-center justify-center rounded-md border text-lg transition-colors ${
            value === e ? 'border-ink bg-band' : 'border-rule hover:bg-band/60'
          }`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function MerchantRow({ row, icon, refresh, glass = false }) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function setEmoji(emoji) {
    setBusy(true);
    setError(null);
    try {
      await api.merchantIcons.update(row.merchant, { emoji });
      await refresh();
      notify(`${row.merchant}'s icon saved`, { type: 'success' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.merchantIcons.uploadImage(row.merchant, file);
      await refresh();
      notify(`${row.merchant}'s photo uploaded`, { type: 'success' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function removePhoto() {
    setBusy(true);
    setError(null);
    try {
      await api.merchantIcons.removeImage(row.merchant);
      await refresh();
      notify(`${row.merchant}'s photo removed`, { type: 'success' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`${glass ? 'gs-row' : 'py-2.5'} ${busy ? 'opacity-50' : ''}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}
        className={`flex w-full cursor-pointer items-center gap-3 text-left ${glass ? 'gs-row-action min-h-11 px-4 py-2' : ''}`}
      >
        <MerchantAvatar merchant={row.merchant} categoryName={row.out?.category ?? row.back?.category} size={34} clickable={false} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink">{row.merchant}</span>
          {/* What the knowledge base says (D189): used to name, type and categorise new statements. */}
          <span className="block truncate text-xs text-muted">
            {[
              row.out && `${row.out.category ?? 'No category'} · ${TXN_TYPE_LABELS[row.out.type] ?? row.out.type ?? '—'}`,
              row.back && `money back: ${TXN_TYPE_LABELS[row.back.type] ?? row.back.type}`,
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
        {glass ? (
          <span className="flex shrink-0 items-center gap-3">
            <span className="text-[15px] text-muted tnum" title={`${row.transaction_count} transactions`}>
              {row.transaction_count}<span className="sr-only"> transactions</span>
            </span>
            <Chevron open={open} />
          </span>
        ) : (
          <span className="shrink-0 text-sm text-faint tnum">
            {row.transaction_count} transaction{row.transaction_count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && <p className={`mt-2 text-sm text-spend ${glass ? 'px-4' : ''}`}>{error}</p>}

      {open && (
        <div className={glass ? 'space-y-3 pt-1 pr-4 pb-4 pl-[62px]' : 'mt-3 ml-[42px] space-y-3'}>
          {row.aliases?.length > 0 && (
            <div>
              <div className="text-xs text-muted">Recognised in statements as</div>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {row.aliases.slice(0, 8).map((a) => (
                  <li key={a.line} className="rounded-md border border-rule bg-band/50 px-2 py-0.5 font-mono text-xs text-ink">
                    {a.line} <span className="text-faint">×{a.n}</span>
                  </li>
                ))}
                {row.aliases.length > 8 && <li className="text-xs text-faint">and {row.aliases.length - 8} more</li>}
              </ul>
            </div>
          )}
          <EmojiPicker value={icon?.emoji ?? null} onChange={setEmoji} />
          <div className="flex items-center gap-3">
            <label className="cursor-pointer text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
              Upload a photo
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadPhoto} className="hidden" />
            </label>
            {icon?.image_path && (
              <button onClick={removePhoto} className="text-sm text-faint underline-offset-2 hover:text-spend hover:underline">
                Remove photo
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

const FILTERS = [
  { value: 'needs', label: 'Needs an icon' },
  { value: 'has', label: 'Has a logo' },
  { value: 'custom', label: 'Customized' },
  { value: 'all', label: 'All' },
];

/**
 * Mirrors `MerchantAvatar`'s own render priority, so this list's
 * filters and counts match what actually shows on screen. A photo is
 * a deliberate choice and always counts as customized. An emoji is a
 * stand-in for "no real logo" — once a domain match exists, the
 * avatar shows that instead, so the merchant now counts as "has a
 * logo," not "customized," even though a row still exists for it.
 */
function classify(merchant, icon) {
  if (icon?.image_path) return 'custom';
  if (lookupMerchantDomain(merchant)) return 'has';
  if (icon?.emoji) return 'custom';
  return 'needs';
}

export function MerchantIcons() {
  const { design } = useDesign();
  const vivid = design === 'vivid';
  const glass = design === 'glass';
  const [merchants, setMerchants] = useState(null);
  const [icons, setIcons] = useState({});
  const [filter, setFilter] = useState('needs');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const refresh = useMerchantIconsRefresh();

  const load = () => {
    Promise.all([api.merchantIcons.allMerchants(), api.merchantIcons.list()])
      .then(([all, customized]) => {
        setMerchants(all);
        const byMerchant = {};
        for (const row of customized) byMerchant[row.merchant] = row;
        setIcons(byMerchant);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => { load(); }, []);

  async function refreshAll() {
    await refresh(); // updates every live MerchantAvatar across the app
    load(); // updates this page's own list
  }

  const rows = useMemo(() => {
    if (!merchants) return [];
    return merchants
      .map((row) => {
        const icon = icons[row.merchant];
        const status = classify(row.merchant, icon);
        return { row, icon, status };
      })
      .filter(({ status }) => filter === 'all' || status === filter)
      .filter(({ row }) => !search.trim() || row.merchant.toLowerCase().includes(search.trim().toLowerCase()));
  }, [merchants, icons, filter, search]);

  const counts = useMemo(() => {
    if (!merchants) return { needs: 0, has: 0, custom: 0 };
    let needs = 0, has = 0, custom = 0;
    for (const row of merchants) {
      const status = classify(row.merchant, icons[row.merchant]);
      if (status === 'custom') custom++;
      else if (status === 'has') has++;
      else needs++;
    }
    return { needs, has, custom };
  }, [merchants, icons]);

  if (glass) {
    return (
      <GlassMerchants
        merchants={merchants} rows={rows} counts={counts} error={error}
        filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} refreshAll={refreshAll}
      />
    );
  }

  return (
    <section className="mb-12">
      <SectionHeader title="Merchants" emoji="🏷️" tint="bg-vivid-pink/15">
        <span className="text-sm text-faint tnum">{merchants?.length ?? '…'}</span>
      </SectionHeader>
      {/* Vivid (D151): how far along the merchant pictures are, at a glance. */}
      {vivid && merchants && (
        <div className="mb-5 rounded-2xl bg-vivid-pink/10 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink">
              {Math.round(((counts.has + counts.custom) / Math.max(merchants.length, 1)) * 100)}% of merchants have a picture
            </span>
            <span className="font-mono text-xs text-muted tnum">
              {counts.has + counts.custom} / {merchants.length}
            </span>
          </div>
          <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-raised">
            <span className="animate-bar-grow bg-vivid-green" style={{ width: `${(counts.has / merchants.length) * 100}%` }} />
            <span className="animate-bar-grow bg-vivid-purple" style={{ width: `${(counts.custom / merchants.length) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
            <span>🖼️ {counts.has} logo{counts.has === 1 ? '' : 's'}</span>
            <span>😀 {counts.custom} emoji</span>
            <span>❓ {counts.needs} still initials</span>
          </div>
        </div>
      )}
      <p className="mb-2 text-sm text-muted">
        What the app knows about each merchant, learned from your own transactions: the bank lines it recognises, and
        its usual category and type for money out and money back. Every new statement is named, typed and categorised from
        this, and every fix you make anywhere becomes its next answer.
      </p>
      <p className="mb-4 text-sm text-muted">
        {counts.needs} merchant{counts.needs === 1 ? '' : 's'} still show a plain initial. Set a photo or an emoji
        to fix one — the change shows up everywhere that merchant appears, immediately.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        <div className="w-56">
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search merchants…" />
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-spend">{error}</p>}

      {merchants === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-faint">No merchants match.</p>
      ) : vivid ? (
        // 236 merchants and counting: the first 20, then "Show all".
        <ShowMore
          items={rows}
          limit={20}
          as="ul"
          className="divide-y divide-rule"
          render={({ row, icon }) => <MerchantRow key={row.merchant} row={row} icon={icon} refresh={refreshAll} />}
        />
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map(({ row, icon }) => (
            <MerchantRow key={row.merchant} row={row} icon={icon} refresh={refreshAll} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Glass (D244). The picture progress reads like iPhone Storage: one bar in
 * segments with a legend of dots, rather than a paragraph with a number in
 * it. The two paragraphs of explanation became footnotes, where Apple puts
 * the "why" under a group. The list is a group with a chevron per row, so a
 * row says it opens; it shows 25, then "Show All".
 */
function GlassMerchants({ merchants, rows, counts, error, filter, setFilter, search, setSearch, refreshAll }) {
  const [showAll, setShowAll] = useState(false);
  const wide = useWide();
  if (error && !merchants) return <p className="px-4 text-[13px] text-spend">{error}</p>;
  if (!merchants) return <p className="px-4 text-[13px] text-muted">Loading…</p>;

  const total = Math.max(merchants.length, 1);
  const pictured = counts.has + counts.custom;
  const legend = [
    { key: 'has', label: 'Logos', n: counts.has, color: 'var(--chart-earn)' },
    { key: 'custom', label: 'Photos & emoji', n: counts.custom, color: 'var(--color-info)' },
    { key: 'needs', label: 'Still initials', n: counts.needs, color: 'rgb(142 142 147 / 0.45)' },
  ];
  const shown = showAll ? rows : rows.slice(0, 25);

  return (
    <div className="space-y-8">
      <GroupSection footnote="Learned from your own transactions: the bank lines each merchant appears as, and its usual category and type. New statements are named and sorted from this, and every fix you make becomes its next answer.">
        <Group as="div" className="px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-ink">
              <span className="tnum">{pictured}</span> of <span className="tnum">{merchants.length}</span> merchants have a picture
            </span>
            <span className="text-[13px] text-muted tnum">{Math.round((pictured / total) * 100)}%</span>
          </div>
          <div className="mt-2.5 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-band" aria-hidden="true">
            {legend.map(({ key, n, color }) => n > 0 && (
              <span key={key} className="animate-bar-grow h-full" style={{ width: `${(n / total) * 100}%`, backgroundColor: color }} />
            ))}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            {legend.map(({ key, label, n, color }) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                {label} <span className="tnum">{n}</span>
              </li>
            ))}
          </ul>
        </Group>
      </GroupSection>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={filter} onChange={(v) => { setFilter(v); setShowAll(false); }} options={FILTERS} />
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[9px] bg-[rgb(118_118_128/0.12)] px-2.5 sm:max-w-64">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-muted">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search merchants"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>

      <GroupSection
        label={`${rows.length} ${rows.length === 1 ? 'merchant' : 'merchants'}`}
        footnote="Open a merchant to give it an emoji or a photo. It changes everywhere that merchant appears, straight away."
      >
        {rows.length === 0 ? (
          <Group as="div" className="px-4 py-8 text-center text-[15px] text-muted">No merchants match.</Group>
        ) : (
          <>
            {/* Wide screens: two lists side by side (D245). */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
              {(wide ? halves(shown) : [shown]).map((column, i) => (
                <Group key={i} inset={62}>
                  {column.map(({ row, icon }) => <MerchantRow key={row.merchant} row={row} icon={icon} refresh={refreshAll} glass />)}
                </Group>
              ))}
            </div>
            {rows.length > shown.length && (
              <button type="button" onClick={() => setShowAll(true)} className="mt-3 w-full rounded-[14px] py-2.5 text-[15px] font-medium text-info transition-colors hover:bg-[var(--g-hover)]">
                Show All <span className="tnum">{rows.length}</span>
              </button>
            )}
          </>
        )}
      </GroupSection>
    </div>
  );
}
