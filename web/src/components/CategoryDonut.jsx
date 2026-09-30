import { useState } from 'react';
import { formatMoney } from '../api';
import { VIVID_MIX_COLORS as MIX_COLORS } from '../designs';

/**
 * "Where it's going," as a ring instead of a bar list — sits beside
 * Activity (75/25 split, Overview.jsx), a quick glanceable mix rather
 * than the exact-amount version already below it ("Where it's
 * going"). The two intentionally coexist: this answers "what's the
 * shape of this month," the bar list answers "how much, exactly."
 *
 * Color here is a deliberate, scoped exception to this app's own
 * "spend/earn are the only saturated colors" rule (CLAUDE.md) — asked
 * for directly ("give some vibrant colors to that card"), and unlike
 * spend/earn, a category's color here carries no money-direction
 * meaning to compete with; it only tells slices apart. A fixed
 * palette would run out and repeat once a month has more categories
 * than colors, so each slice's hue comes from the golden angle
 * (137.508°) instead — evenly spread regardless of count, deterministic
 * by sort position, no two adjacent slices ever landing on close hues.
 */
const hueFor = (i) => (i * 137.508) % 360;
const colorFor = (i) => `hsl(${hueFor(i)}, 72%, 56%)`;

const SIZE = 148;
const STROKE = 22;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const LEGEND_LIMIT = 6;

export function CategoryDonut({ byCategory, total: officialTotal }) {
  const [hovered, setHovered] = useState(null);

  const sorted = byCategory
    .map((c) => ({ id: c.category_id ?? 'none', name: c.name, amount: Math.abs(c.spend_cents) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // The ring's own arcs are sized off the categories shown (so they
  // always close into a full circle with no gap); the center label
  // uses the household's one official "this month" spend figure
  // instead (same value the Spent card above already shows) when
  // given one, since a category can occasionally net positive on
  // refunds and get excluded here while still counting elsewhere —
  // this app already tolerates that in the bar-list version of this
  // same data, just less visibly than a single total number would.
  const arcTotal = sorted.reduce((sum, s) => sum + s.amount, 0);
  const centerTotal = officialTotal ?? arcTotal;

  if (sorted.length === 0 || arcTotal === 0) {
    return <p className="text-sm text-muted">Nothing spent this month.</p>;
  }

  // Each slice's start point is how much came before it — n is at
  // most a couple dozen real categories, so a plain slice+reduce per
  // row is simpler than threading a running total through the map,
  // and there's nothing here worth the extra code to optimize away.
  const arcs = sorted.map((s, i) => {
    const before = sorted.slice(0, i).reduce((sum, x) => sum + x.amount, 0);
    const frac = s.amount / arcTotal;
    const dash = frac * C;
    const offset = -(before / arcTotal) * C;
    return { ...s, color: colorFor(i), dash, offset, pct: Math.round(frac * 100) };
  });

  const shown = arcs.slice(0, LEGEND_LIMIT);
  const rest = arcs.slice(LEGEND_LIMIT);
  const restAmount = rest.reduce((sum, a) => sum + a.amount, 0);

  return (
    <div className="flex flex-col items-center">
      <div className="animate-pop-in relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-band)" strokeWidth={STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.id}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={STROKE}
              strokeDasharray={`${a.dash} ${C - a.dash}`}
              strokeDashoffset={a.offset}
              opacity={hovered && hovered !== a.id ? 0.3 : 1}
              className="transition-opacity duration-200"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-sm font-semibold tnum text-ink">{formatMoney(centerTotal)}</div>
          <div className="text-[11px] text-faint">spent</div>
        </div>
      </div>

      <ul className="mt-4 w-full space-y-1.5">
        {shown.map((a, i) => (
          <li
            key={a.id}
            className="animate-drop-in flex items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors"
            style={{ '--dy': '6px', animationDelay: `${i * 40}ms`, backgroundColor: hovered === a.id ? 'var(--color-band)' : undefined }}
            onMouseEnter={() => setHovered(a.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
            <span className="min-w-0 flex-1 truncate text-muted">{a.name}</span>
            <span className="shrink-0 font-mono tnum text-ink">{a.pct}%</span>
          </li>
        ))}
        {rest.length > 0 && (
          <li className="flex items-center gap-2 px-1 py-0.5 text-xs">
            <span className="size-2.5 shrink-0 rounded-full bg-band" />
            <span className="min-w-0 flex-1 truncate text-faint">+{rest.length} more</span>
            <span className="shrink-0 font-mono tnum text-faint">{formatMoney(restAmount)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * The Vivid design's take on the same card (Settings → Design): one
 * segmented bar for the whole month's mix, then a colored progress
 * bar per category, scaled to the biggest one. Same inputs and the
 * same "center total = the Spent card's own figure" rule as the ring
 * above. Its six colors are the Vivid theme tokens in a fixed order,
 * rather than the ring's golden-angle hues: six slices is all this
 * shows before "+N more", so a fixed set can't run out.
 */

export function SpendMixBars({ byCategory, total: officialTotal }) {
  const sorted = byCategory
    .map((c) => ({ id: c.category_id ?? 'none', name: c.name, amount: Math.abs(c.spend_cents) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const sum = sorted.reduce((s, c) => s + c.amount, 0);

  if (sorted.length === 0 || sum === 0) {
    return <p className="text-sm text-muted">Nothing spent this month.</p>;
  }

  const shown = sorted.slice(0, MIX_COLORS.length).map((c, i) => ({ ...c, color: MIX_COLORS[i] }));
  const rest = sorted.slice(MIX_COLORS.length);
  const restAmount = rest.reduce((s, c) => s + c.amount, 0);
  const max = shown[0].amount;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">spent this month</span>
        <span className="font-mono text-sm font-semibold tnum text-ink">{formatMoney(officialTotal ?? sum)}</span>
      </div>

      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Spend by category, share of the month">
        {shown.map((c) => (
          <span key={c.id} className={`animate-bar-grow ${c.color}`} style={{ width: `${(c.amount / sum) * 100}%` }} />
        ))}
        {restAmount > 0 && <span className="bg-rule" style={{ width: `${(restAmount / sum) * 100}%` }} />}
      </div>

      <ul className="flex flex-col gap-2.5">
        {shown.map((c, i) => (
          <li key={c.id}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-ink">{c.name}</span>
              <span className="shrink-0 font-mono text-xs tnum text-ink">{formatMoney(c.amount)}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-band">
              <div
                className={`animate-bar-grow h-1.5 rounded-full ${c.color}`}
                style={{ width: `${(c.amount / max) * 100}%`, animationDelay: `${i * 40}ms` }}
              />
            </div>
          </li>
        ))}
        {rest.length > 0 && (
          <li className="flex items-baseline justify-between text-sm text-faint">
            <span>+{rest.length} more</span>
            <span className="font-mono text-xs tnum">{formatMoney(restAmount)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
