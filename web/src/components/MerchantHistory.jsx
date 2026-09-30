import { useEffect, useState } from 'react';
import { api, formatMoney, formatShortDate } from '../api';
import { MerchantAvatar } from './MerchantAvatar';
import { MiniTrend } from './MiniTrend';
import { CategoryGlyph, defaultIconFor } from '../category-icons';
import { avatarColorFor } from '../merchant-logos';

// A small colored badge, one deterministic color per category name —
// the same avatarColorFor palette MerchantAvatar's own category
// fallback and IncomeDetail's OtherIncomeCard already use for exactly
// this (a muted, non-spend/earn set, so it never competes with the
// app's two real accent colors). Reused here for the category chips
// and the Recent cards below so the same category reads as the same
// color in both places within one card.
function CategoryBadge({ name, iconKey, size = 20 }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, backgroundColor: avatarColorFor(name) }}
    >
      <CategoryGlyph iconKey={iconKey} size={size * 0.55} />
    </span>
  );
}

function CategoryChip({ category, active, onClick }) {
  const iconKey = category.category_icon_key ?? defaultIconFor(category.category_name);
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors ${
        active
          ? 'border-earn bg-earn/10 text-ink'
          : 'border-rule text-muted hover:border-rule-str hover:text-ink'
      }`}
    >
      <CategoryBadge name={category.category_name} iconKey={iconKey} size={20} />
      {category.category_name}
    </button>
  );
}

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Handles both 'YYYY-MM' (by_month) and 'YYYY-MM-DD' (first_seen/
// last_seen) — only the first two parts ever get read. A 2-digit year
// buys the by-month column enough width back that the label never
// wraps ("September 2026" did, at the old column width) — the actual
// bar gets the room instead.
const monthYear = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${SHORT_MONTH[m - 1]} ${String(y).slice(2)}`;
};

/**
 * The big total counts up on mount rather than just appearing — the
 * one deliberate moment of motion this card gets (see the module
 * comment below for why it's the only one). Skips straight to the
 * real value under prefers-reduced-motion, same as the rest of the
 * app's animation respects it, just not through the CSS rule that
 * handles every other animation here since this one drives React
 * state from rAF, not a CSS transition.
 */
function useCountUp(target) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    if (reduced) return; // render returns `target` directly below instead
    let raf;
    const start = performance.now();
    const duration = 700;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setAnimated(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return reduced ? target : animated;
}

/**
 * "How much have I spent at Costco lately?" — a lightweight popover,
 * not a page. It's a drill-down utility off the ledger, not a
 * destination anyone navigates to directly.
 *
 * Redesigned from a generic "two bordered boxes + a cramped list"
 * shape into the same headline-stat-plus-trend language the rest of
 * this app's drill-downs already settled on (IncomeDetail,
 * SecondaryDetail) — a merchant's lifetime total is exactly the kind
 * of hero figure that pattern was built for, so this brings it in
 * line instead of staying the odd one out. The by-month and recent
 * lists get the ledger's own alternating-row band (`bg-band`, the
 * palette's whole reason for existing per CLAUDE.md) instead of a
 * plain list — texture this app already has everywhere else, just
 * missing here.
 *
 * One deliberate animated moment, not several: the total counts up on
 * open. No per-row fade-ins, no hover gimmicks — restraint is the
 * point, per this app's own "quiet surface, numbers as the hero" rule.
 */
// A real, distinct filter — "only this merchant's uncategorized
// rows" — not the absence of one. `categoryId` state uses `null` for
// "nothing selected, show everything blended" and this sentinel for
// the Uncategorized chip specifically; collapsing both onto `null`
// (a category with no category_id has category_id === null too) is
// what made that chip look pre-selected before any click and made
// clicking it a no-op.
const UNCATEGORIZED = 'none';

export function MerchantHistory({ merchant, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [categoryId, setCategoryId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.transactions.merchantSummary(merchant, categoryId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [merchant, categoryId]);

  const selectCategory = (id) => {
    const key = id ?? UNCATEGORIZED;
    setCategoryId((current) => (current === key ? null : key));
  };

  const maxMonthAmount = data
    ? Math.max(...data.by_month.map((m) => Math.abs(m.net_cents ?? 0)), 1)
    : 1;

  // A category slice isn't always spend — Cashback, a refund, or a
  // Card Payment credit nets positive, and showing that as "$0.00 of
  // spend" (the bug this fixes) is worse than showing nothing. Which
  // way it reads is decided here, once, from the actual sign of the
  // money — not assumed to be spend the way the card used to be.
  const netCents = data?.net_cents ?? 0;
  const isReceived = netCents >= 0;
  const animatedTotal = useCountUp(Math.abs(netCents));

  // Ascending order (oldest first, current month last), the shape
  // MiniTrend was built to draw — the query itself returns newest
  // first for the by-month list below, so this only reverses the copy
  // used for the trend.
  const trendMonths = data ? [...data.by_month].slice(0, 12).reverse() : [];

  const categoryById = new Map((data?.by_category ?? []).map((c) => [c.category_id, c]));

  // Once there's enough history to make one long column feel like
  // scrolling forever, split it into two — the whole point of giving
  // this card more room in the first place. A handful of months stays
  // single-column; splitting three rows into two half-empty columns
  // would look sparser, not tidier.
  const monthGridClass = (data?.by_month.length ?? 0) > 6 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1';

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        className="animate-pop-in max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-rule bg-raised p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg ring-2 ring-offset-2 ring-offset-raised ${isReceived ? 'ring-earn/30' : 'ring-spend/30'}`}>
              <MerchantAvatar merchant={merchant} size={48} />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-ink">{merchant}</h3>
              {data && (
                <p className="mt-0.5 text-xs text-muted">
                  {data.first_seen && `Since ${monthYear(data.first_seen)} · `}
                  {data.transaction_count} transaction{data.transaction_count === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-spend">{error}</p>}

        {!data && !error && <p className="text-sm text-muted">Loading…</p>}

        {data && (
          <>
            <div className="mb-5 flex items-end justify-between gap-4 border-b border-rule pb-5">
              <div>
                <div className="text-xs text-muted">{isReceived ? 'Total received' : 'Total spent'}</div>
                <div className={`mt-1 font-mono text-3xl font-semibold tnum ${isReceived ? 'text-earn' : 'text-spend'}`}>
                  {!isReceived && '−'}
                  {formatMoney(animatedTotal)}
                </div>
              </div>
              {trendMonths.length > 1 && (
                <MiniTrend months={trendMonths} valueKey="net_cents" tone={isReceived ? 'earn' : 'spend'} />
              )}
            </div>

            {/* Split by category: a merchant like Tesla covers both a
                subscription and Supercharging, and blending those into
                one total was the actual complaint this solves. Click a
                category to narrow everything below to just that slice;
                click it again (or nothing's selected) to see it all. */}
            {data.by_category.length > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-1.5">
                {data.by_category.map((c) => (
                  <CategoryChip
                    key={c.category_id ?? 'none'}
                    category={c}
                    active={categoryId === (c.category_id ?? UNCATEGORIZED)}
                    onClick={() => selectCategory(c.category_id)}
                  />
                ))}
              </div>
            )}

            {data.by_month.length > 0 && (
              <div className="mb-5">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
                  By month
                </div>
                <div className={`grid gap-x-6 ${monthGridClass}`}>
                  {data.by_month.map((m, i) => {
                    const net = m.net_cents ?? 0;
                    const amount = Math.abs(net);
                    return (
                      <div key={m.month} className="odd:bg-band/40 flex items-center gap-2 rounded px-1.5 py-1 text-sm">
                        <div className="w-12 shrink-0 text-xs text-muted">{monthYear(m.month)}</div>
                        <div className="flex-1">
                          <div
                            className={`animate-bar-grow h-2.5 rounded-r ${net < 0 ? 'bg-spend' : 'bg-earn'}`}
                            style={{
                              width: `${Math.max((amount / maxMonthAmount) * 100, amount > 0 ? 2 : 0)}%`,
                              animationDelay: `${Math.min(i * 25, 300)}ms`,
                            }}
                          />
                        </div>
                        <div className={`w-20 shrink-0 text-right font-mono text-xs tnum ${amount > 0 ? (net < 0 ? 'text-spend' : 'text-earn') : ''}`}>
                          {amount > 0 ? formatMoney(net, { showSign: true }) : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
                Recent
              </div>
              {/* Cards, not a list — the same shape IncomeDetail's
                  OtherIncomeCard already uses for "several short
                  entries" (icon + amount, then a label, then a date).
                  Eight rows of list took eight rows of height; the
                  same eight transactions fit in three here. */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {data.recent.map((t, i) => {
                  const cat = categoryById.get(t.category_id);
                  const categoryName = cat?.category_name ?? 'Uncategorized';
                  return (
                    <div
                      key={t.id}
                      className="animate-drop-in rounded-xl border border-rule bg-raised px-3 py-2.5 transition-[transform,border-color] hover:-translate-y-0.5 hover:border-rule-str"
                      style={{ '--dy': '10px', animationDelay: `${Math.min(i * 30, 240)}ms` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <CategoryBadge
                          name={categoryName}
                          iconKey={cat?.category_icon_key ?? defaultIconFor(categoryName)}
                          size={26}
                        />
                        <span className={`font-mono text-sm tnum ${t.amount_cents < 0 ? 'text-spend' : 'text-earn'}`}>
                          {formatMoney(t.amount_cents, { showSign: true })}
                        </span>
                      </div>
                      <div className="mt-1.5 truncate text-xs text-ink" title={categoryName}>{categoryName}</div>
                      <div className="text-xs text-faint">{formatShortDate(t.posted_date)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
