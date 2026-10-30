import { memo } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../../api';
import { CategoryGlyph } from '../../../lib/categories/category-icons';
import { txnName, accountShort } from '../../../lib/transactions/txn-name';
import { Loading } from '../../ui/Loading';

/**
 * The 30% beside "Where it's going" (D373): every category by default, and
 * a picked category's transactions —
 * filtered to one merchant when a merchant stone is picked.
 */
const pct = (part, whole) => (whole > 0 && part / whole < 0.01 ? '<1%' : `${Math.round((part / (whole || 1)) * 100)}%`);
const day = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const monthHead = (iso) => new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export function Swatch({ item, size = 'size-7' }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-[38%_42%_36%_44%] ${item.color.onDark ? 'text-black/80' : 'text-white'}`}
      style={{ backgroundColor: item.color.css }} aria-hidden="true">
      <CategoryGlyph iconKey={item.icon} size={14} />
    </span>
  );
}

// Memoised: the card's hover updates many times a second and must not re-render this list.
export const WherePanel = memo(function WherePanel({ items, family, total, span, picked, transactions, merchant, onPick, onBack, onMerchant, onHover }) {
  const ofWhat = span === 'ytd' ? 'the year' : 'the month';
  if (!picked) {
    return (
      <div className="flex h-full flex-col">
        <div className="px-4 pb-2 pt-4">
          {family && <button type="button" onClick={onBack} className="mb-1 text-sm text-muted hover:text-ink">‹ All families</button>}
          <h4 className="text-base font-medium text-ink">{family ? family.name : 'Categories'}</h4>
          <div className="text-xs text-muted tnum">{family ? `${formatMoney(family.value)} · ${pct(family.value, total)} · pick a category` : 'Click one here or on the left'}</div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {items.map((i) => (
            <li key={i.key}>
              <button type="button" onClick={() => onPick(i.key)} onPointerEnter={() => onHover(i.key)} onPointerLeave={() => onHover(null)}
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-xl px-2 py-1.5 text-left hover:bg-band">
                <span className="row-span-2"><Swatch item={i} /></span>
                <span className="truncate text-sm text-ink">{i.name}</span>
                <span className="font-mono text-sm font-medium tnum text-ink">{formatMoney(i.value)}</span>
                <span className="col-span-2 text-xs text-muted tnum">{i.familyName} · {pct(i.value, total)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Rows named as everywhere else in the app (a Zelle line reads "To Name · memo", D174).
  const rows = (transactions ?? []).map((t) => ({ ...t, name: txnName(t) ?? '—' })).filter((t) => !merchant || t.name === merchant);
  // A month heading, with that month's total, above each month's first row in the year so far.
  const months = new Map();
  if (span === 'ytd') for (const t of rows) { const m = t.posted_date.slice(0, 7); months.set(m, (months.get(m) ?? 0) - t.amount_cents); }
  const heads = new Set();
  return (
    <div className="flex h-full flex-col">
      <div className="relative px-4 pb-3 pt-4">
        <div className="flex items-center gap-3 pr-7">
          <Swatch item={picked} size="size-10" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-ink">{picked.name}</span>
              <span className="font-mono text-base font-semibold tnum text-ink">{formatMoney(picked.value)}</span>
            </div>
            <div className="truncate text-xs text-muted tnum">{picked.count} txn{picked.count === 1 ? '' : 's'} · {pct(picked.value, total)} of {ofWhat}</div>
          </div>
        </div>
        <button type="button" onClick={onBack} aria-label="Back to the categories"
          className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full text-muted hover:bg-band hover:text-ink">✕</button>
        {merchant && (
          <button type="button" onClick={() => onMerchant(merchant)} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-band px-2.5 py-0.5 text-xs text-ink">
            {merchant} · {rows.length} <span aria-hidden="true" className="text-muted">✕</span><span className="sr-only">Clear the merchant filter</span>
          </button>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!transactions && <li><Loading /></li>}
        {rows.map((t) => {
          const m = t.posted_date.slice(0, 7), head = span === 'ytd' && !heads.has(m) ? monthHead(t.posted_date) : null;
          if (head) heads.add(m);
          return (
            <li key={t.id}>
              {head && (
                <div className="sticky top-0 z-10 mb-1 mt-3 flex items-baseline justify-between rounded-lg bg-band px-2 py-1.5 first:mt-0">
                  <span className="text-[13px] font-semibold text-ink">{head}</span>
                  <span className="font-mono text-xs tnum text-muted">{formatMoney(months.get(m))}</span>
                </div>
              )}
              {/* Opens the row on Transactions (?txn, D284): its account and month, the row open and in view. */}
              <Link to={`/transactions?txn=${t.id}`} title="Open in Transactions"
                className="group grid grid-cols-[1fr_auto] gap-x-3 rounded-xl px-2 py-1.5 hover:bg-band focus-visible:bg-band">
                <span className="truncate text-sm text-ink">{t.name}</span>
                <span className={`font-mono text-sm font-medium tnum ${t.amount_cents > 0 ? 'text-earn' : 'text-ink'}`}>
                  {formatMoney(Math.abs(t.amount_cents), { showSign: false })}{t.amount_cents > 0 ? ' back' : ''}
                </span>
                <span className="col-span-2 flex items-center justify-between gap-2 text-xs text-muted tnum">
                  <span className="truncate">{day(t.posted_date)} · {accountShort(t).label}</span>
                  <span aria-hidden="true" className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Open ›</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

/** The frosted card that names what's under the pointer. `at` is { x, y } in the stage. */
export function WhereHoverCard({ item, merchant, family, total, span, at }) {
  if (!at || (!item && !merchant && !family)) return null;
  const color = item?.color.css ?? family?.color.css ?? merchant.color;
  const below = at.y < 110;                       // no room above: hang it under the pointer instead of clipping
  return (
    <div className={`pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-2xl border border-rule bg-raised/85 px-3 py-2 shadow-lg backdrop-blur-xl ${below ? 'translate-y-[34px]' : '-translate-y-[calc(100%+14px)]'}`}
      style={{ left: Math.max(at.x, 120), top: at.y }}>
      <div className="flex items-center gap-2 text-sm font-medium text-ink"><i className="size-2.5 rounded-full" style={{ backgroundColor: color }} />{item?.name ?? family?.name ?? merchant.name}</div>
      <div className="font-mono text-lg font-semibold tnum text-ink">{formatMoney(item?.value ?? family?.value ?? merchant.value)}</div>
      <div className="text-xs text-muted tnum">
        {family ? `${family.count} categor${family.count === 1 ? 'y' : 'ies'} · ${pct(family.value, total)} · click to open` : item ? `${item.familyName} · ${pct(item.value, total)} of ${span === 'ytd' ? 'the year' : 'the month'} · ${item.count} txn${item.count === 1 ? '' : 's'}` : `at ${merchant.parent} · click to filter`}
      </div>
    </div>
  );
}
