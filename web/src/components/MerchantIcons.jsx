import { useEffect, useMemo, useState } from 'react';
import { useDesign } from '../design-context';
import { ShowMore } from './ui/DetailDialog';
import { api } from '../api';
import { lookupMerchantDomain } from '../merchant-logos';
import { useMerchantIconsRefresh } from '../merchant-icons-context';
import { MerchantAvatar } from './MerchantAvatar';
import { TextInput, Segmented, SectionHeader } from './Form';

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

function MerchantRow({ row, icon, refresh }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function setEmoji(emoji) {
    setBusy(true);
    setError(null);
    try {
      await api.merchantIcons.update(row.merchant, { emoji });
      await refresh();
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`py-2.5 ${busy ? 'opacity-50' : ''}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-3 text-left"
      >
        <MerchantAvatar merchant={row.merchant} size={34} clickable={false} />
        <span className="min-w-0 flex-1 truncate text-ink">{row.merchant}</span>
        <span className="shrink-0 text-sm text-faint tnum">
          {row.transaction_count} transaction{row.transaction_count === 1 ? '' : 's'}
        </span>
      </div>

      {error && <p className="mt-2 text-sm text-spend">{error}</p>}

      {open && (
        <div className="mt-3 ml-[42px] space-y-3">
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
  const vivid = useDesign().design === 'vivid';
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

  return (
    <section className="mb-12">
      <SectionHeader title="Merchant icons" emoji="🏷️" tint="bg-vivid-pink/15">
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
