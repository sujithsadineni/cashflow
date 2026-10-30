import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../../../hooks/use-api';
import { api, formatMoney, maskName } from '../../../api';
import { Dropdown } from '../../ui/Dropdown';
import { PersonAvatar } from '../../ui/PersonAvatar';
import { defaultIconFor } from '../../../lib/categories/category-icon-keys';
import { categoryPalette, fallbackColor, familyColor } from '../../../lib/overview/category-palette';
import { familyOf, FAMILIES } from '../../../lib/overview/spend-families';
import { WherePebbles } from './WherePebbles';
import { WhereMosaic } from './WhereMosaic';
import { WhereWallet } from './WhereWallet';
import { WhereBars } from './WhereBars';
import { WherePanel, WhereHoverCard } from './WherePanel';
import { txnName } from '../../../lib/transactions/txn-name';
import { Loading } from '../../ui/Loading';

/**
 * "Where it's going" (D373, the owner's design): which categories the
 * money went to, for a month or the year so far, the household or one
 * person — the page's Month/YTD picks the span — drawn as pebbles
 * (animated or fixed: a tile opens its transactions beside it), a Wallet card, or the
 * original bars, beside a panel that lists the picked category's
 * transactions. The design and pebble style are remembered per browser.
 */
const DESIGNS = [{ value: 'pebbles', label: 'Pebbles' }, { value: 'wallet', label: 'Wallet card' }, { value: 'bars', label: 'Bars' }];
const STYLES = [{ value: 'animated', label: 'Animated' }, { value: 'fixed', label: 'Fixed' }];
const read = (k, fallback) => { try { return localStorage.getItem(`cashflow.where.${k}`) ?? fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(`cashflow.where.${k}`, v); } catch { /* private window: this session only */ } };
const ytdCaption = (month) => {
  const [y, m] = month.split('-').map(Number), short = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  return m === 1 ? `Jan ${y}` : `Jan–${short} ${y}`;
};

export function WhereItsGoing({ month, people = [], span = 'month', className = 'mb-10' }) {
  const [design, setDesign] = useState(() => read('design', 'pebbles'));
  const [style, setStyle] = useState(() => read('style', 'animated'));
  const [person, setPerson] = useState('');
  const [picked, setPicked] = useState(null);
  const [merchant, setMerchant] = useState(null);
  const [hover, setHover] = useState(null);
  const [family, setFamily] = useState(null);           // Wallet card: the family opened, or null for all families              // { key, at }

  const where = useApi(`where:${month}:${span}:${person}`, () => api.where(month, span, person), { tags: ['transactions'] });
  // Which month/span/person the pebbles last popped in for (D376): it moves once that one's data is
  // in, so a new month replays the pop with its own categories, not the old ones.
  const keyNow = `${month}:${span}:${person}`;
  const [replay, setReplay] = useState(keyNow);
  if (!where.loading && where.data && replay !== keyNow) setReplay(keyNow);
  const cats = useApi('categories', () => api.categories(), { tags: ['categories'] });
  const palette = useMemo(() => categoryPalette(cats.data ?? []), [cats.data]);
  const items = useMemo(() => (where.data?.categories ?? []).map((c) => {
    const fam = familyOf(c.name);
    return { key: c.name, id: c.category_id, name: c.name, value: -c.spend_cents, count: c.count, icon: c.icon_key ?? defaultIconFor(c.name),
             color: palette.get(c.name) ?? fallbackColor(c.name), family: fam.key, familyName: fam.name };
  }), [where.data, palette]);
  const total = items.reduce((s, i) => s + i.value, 0);
  const pickedItem = items.find((i) => i.key === picked) ?? null;

  const txns = useApi(pickedItem ? `where:txns:${month}:${span}:${person}:${pickedItem.id ?? 'none'}` : null,
    () => api.whereTransactions(month, span, person, pickedItem.id), { tags: ['transactions'] });
  // A picked category's merchants become stones of their own (Pebbles, animated).
  const merchants = useMemo(() => {
    if (!pickedItem || !txns.data) return [];
    const by = new Map();
    for (const t of txns.data.transactions) { const n = txnName(t) ?? '—'; by.set(n, (by.get(n) ?? 0) - t.amount_cents); }
    return [...by].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([name, value], i) => ({
      key: `m:${name}`, name, value, parent: pickedItem.name,
      color: `oklch(${Math.min(Math.max(pickedItem.color.L + ((i % 3) - 1) * 0.08, 0.3), 0.9)} ${pickedItem.color.C} ${pickedItem.color.h})`,
    }));
  }, [pickedItem, txns.data]);

  // A picked category that's gone (another month, another person) un-picks itself.
  if (where.data && picked && !pickedItem) { setPicked(null); setMerchant(null); }

  const view = design === 'pebbles' ? `pebbles-${style}` : design;
  const pick = useCallback((key) => {
    setMerchant(null);
    setPicked((p) => (p === key ? null : key));
  }, []);
  const back = useCallback(() => {
    if (merchant) setMerchant(null);
    else if (picked) setPicked(null);
    else setFamily(null);
    setHover(null);
  }, [merchant, picked]);
  const openFamily = useCallback((key) => { setFamily(key); setPicked(null); setMerchant(null); setHover(null); }, []);
  useEffect(() => {
    if (!picked && !merchant && !family) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') back(); };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [picked, merchant, family, back]);
  const onHover = useCallback((key, at) => setHover(key ? { key, at } : null), []);
  const hoverRow = useCallback((key) => onHover(key, null), [onHover]);
  const toggleMerchant = useCallback((m) => setMerchant((x) => (x === m ? null : m)), []);
  const choose = (setter, k) => (v) => { setter(v); save(k, v); setPicked(null); setMerchant(null); setHover(null); setFamily(null); };

  const caption = span === 'ytd' ? ytdCaption(month) : new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const refundsBack = where.data?.refunds_over_cents ?? 0;
  const personOptions = [{ value: '', label: 'Household' }, ...people.map((p) => ({ value: String(p.id), label: maskName(p.name), icon: <PersonAvatar person={p} size={20} /> }))];
  const hoverItem = hover && items.find((i) => i.key === hover.key);
  const hoverMerchant = hover && merchants.find((m) => m.key === hover.key);
  // The Wallet card shows families first; each family's colour and total.
  const families = useMemo(() => FAMILIES.map((f) => {
    const members = items.filter((i) => i.family === f.key);
    return { key: f.key, name: f.name, value: members.reduce((s, i) => s + i.value, 0), count: members.length, color: familyColor(f) };
  }).filter((f) => f.value > 0), [items]);
  const hoverFamily = hover?.key?.startsWith('fam:') ? families.find((f) => `fam:${f.key}` === hover.key) : null;
  const walletFamily = view === 'wallet' && family ? families.find((f) => f.key === family) : null;
  const panelItems = walletFamily ? items.filter((i) => i.family === walletFamily.key) : items;
  const common = { replay, items, picked, hover: hover?.key ?? null, onPick: pick, onHover };

  return (
    <section className={`apple-pane rounded-2xl border border-rule bg-raised p-5 ${className}`} aria-label="Where it's going">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h3 className="text-base font-medium text-ink">Where it&apos;s going</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="w-40"><Dropdown value={design} onChange={choose(setDesign, 'design')} options={DESIGNS} aria-label="Design" /></div>
          {design === 'pebbles' && <div className="w-40"><Dropdown value={style} onChange={choose(setStyle, 'style')} options={STYLES} aria-label="Pebble style" /></div>}
          {people.length > 1 && (
            <div className="w-44"><Dropdown value={person} onChange={(v) => { setPerson(v); setPicked(null); setMerchant(null); setFamily(null); }} options={personOptions} aria-label="Person" /></div>
          )}
        </div>
      </div>
      <p className="mb-4 mt-1 text-xs text-muted tnum">
        {caption} · {formatMoney(total)} across {items.length} categor{items.length === 1 ? 'y' : 'ies'}
        {refundsBack > 0 && <> · {formatMoney(refundsBack)} back in refunds · {formatMoney(-(where.data?.net_cents ?? 0))} spent</>}
      </p>
      {where.error ? <p className="text-sm text-spend">{where.error}</p> : !where.data ? <Loading /> : items.length === 0 ? (
        <p className="text-sm text-muted">Nothing spent {span === 'ytd' ? 'this year so far' : 'this month'}.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(16rem,3fr)]">
          <div className="relative h-[26rem] overflow-hidden rounded-2xl bg-band sm:h-[34rem] lg:h-[max(21rem,calc(100dvh-var(--where-above,30rem)))]" onClick={(e) => { if (e.target === e.currentTarget && picked) back(); }}>
            {view === 'pebbles-animated' && <WherePebbles {...common} merchants={merchants} merchant={merchant} onMerchant={toggleMerchant} />}
            {view === 'pebbles-fixed' && <WhereMosaic {...common} />}
            {view === 'wallet' && <WhereWallet {...common} families={families} family={walletFamily} onFamily={openFamily} onBack={back} total={total} caption={caption} />}
            {view === 'bars' && <WhereBars {...common} />}
            <WhereHoverCard item={hoverItem} merchant={hoverMerchant} family={hoverFamily} total={total} span={span} at={hover?.at} />
          </div>
          <div className="h-[28rem] overflow-hidden rounded-2xl border border-rule lg:h-[max(21rem,calc(100dvh-var(--where-above,30rem)))]">
            <WherePanel items={panelItems} family={walletFamily} total={total} span={span} picked={pickedItem} transactions={pickedItem ? txns.data?.transactions : null}
              merchant={merchant} onPick={pick} onBack={back} onMerchant={toggleMerchant} onHover={hoverRow} />
          </div>
        </div>
      )}
    </section>
  );
}
