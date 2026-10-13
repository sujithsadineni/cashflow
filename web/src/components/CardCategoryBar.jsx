import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../api';
import { useDesign } from '../use-design';
import { CategoryGlyph } from '../category-icons';
import { defaultIconFor } from '../category-icon-keys';
import { avatarColorFor } from '../merchant-logos';
import { chipKey, netOf, shareOf, totalLines } from '../card-summary';

/**
 * Above the Cards page's table (D198, redesigned D203 as the owner's
 * pick, "B1"):
 *   - one line of category chips (icon, name, count; no amounts, so
 *     about twice as many fit) that scrolls sideways and fades at the
 *     edge; the picked chip shows × to clear it
 *   - "All categories" opens every category with its amount
 *   - a compact strip of totals, each cell on one line, split by
 *     dividers: what's showing · In on a pale green cell · Out on a
 *     pale red one · Net set heavier. It follows the card, the month
 *     and the category, like the table under it
 *   - with a category picked, its share of all money in or out
 * The sums come from the API's category summary; the words from
 * card-summary.js. Classic keeps to spend/earn tints; Vivid fills the chips.
 */

const TONE = { spend: 'text-spend', earn: 'text-earn', ink: 'text-ink' };
const TINT = { earn: 'bg-earn/5 shadow-[inset_0_2px_0_var(--color-earn)]', spend: 'bg-spend/5 shadow-[inset_0_2px_0_var(--color-spend)]' };
const FADE = { maskImage: 'linear-gradient(to right, #000 calc(100% - 2.5rem), transparent)' };

function Badge({ name, iconKey }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: avatarColorFor(name) }}>
      <CategoryGlyph iconKey={iconKey} size={11} />
    </span>
  );
}

const nameOf = (c) => c.category_name ?? 'Uncategorised';

export function CardCategoryBar({ summary, selected, onSelect, accountType, scopeLabel }) {
  const vivid = useDesign().design === 'vivid';
  const [open, setOpen] = useState(false);
  const rail = useRef(null);
  const current = selected == null ? null : summary.categories.find((c) => chipKey(c) === selected);
  const scope = current ?? summary.total;
  const lines = totalLines(scope, accountType);
  const share = shareOf(current, summary.total);

  // A category picked from the full list scrolls its chip into view.
  useEffect(() => {
    rail.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  const chip = (active) =>
    `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border py-0.5 text-sm transition-colors ${
      active ? 'border-earn bg-earn/10 text-ink'
        : vivid ? 'border-transparent bg-band text-ink hover:bg-rule'
          : 'border-rule text-muted hover:border-rule-str hover:text-ink'
    }`;
  const pick = (key) => { onSelect(selected === key ? null : key); setOpen(false); };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <div ref={rail} style={FADE} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto p-0.5 pr-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => onSelect(null)} aria-pressed={selected == null} className={`${chip(selected == null)} px-3`}>
            All <span className="font-mono text-xs tnum text-faint">{summary.total.count}</span>
          </button>
          {summary.categories.map((c) => {
            const key = chipKey(c);
            const on = selected === key;
            return (
              <button key={key} onClick={() => pick(key)} aria-pressed={on} title={formatMoney(netOf(c), { showSign: true })} className={`${chip(on)} pl-0.5 pr-3`}>
                <Badge name={nameOf(c)} iconKey={c.category_icon_key ?? defaultIconFor(nameOf(c))} />
                {nameOf(c)}
                <span className="font-mono text-xs tnum text-faint">{c.count}</span>
                {on && <span aria-label="Clear" className="text-xs text-muted">×</span>}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 whitespace-nowrap rounded-md border border-rule-str px-2.5 py-1 text-sm text-ink transition-colors hover:bg-band"
        >
          All categories {open ? '▴' : '▾'}
        </button>
      </div>

      {open && (
        <div className={`mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 border border-rule bg-raised p-2 sm:grid-cols-2 lg:grid-cols-3 ${vivid ? 'rounded-xl' : 'rounded-lg'}`}>
          {summary.categories.map((c) => {
            const key = chipKey(c);
            const net = netOf(c);
            return (
              <button
                key={key}
                onClick={() => pick(key)}
                className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors ${selected === key ? 'bg-earn/10' : 'hover:bg-band'}`}
              >
                <Badge name={nameOf(c)} iconKey={c.category_icon_key ?? defaultIconFor(nameOf(c))} />
                <span className="truncate text-ink">{nameOf(c)} <span className="font-mono text-xs tnum text-faint">{c.count}</span></span>
                <span className={`font-mono text-xs tnum ${net < 0 ? 'text-spend' : net > 0 ? 'text-earn' : 'text-muted'}`}>{formatMoney(net, { showSign: true })}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* One line per cell, dividers between: what's showing · in · out · net. */}
      <div className={`mt-2.5 grid grid-cols-3 overflow-hidden border border-rule bg-raised text-sm md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] ${vivid ? 'rounded-xl' : 'rounded-lg'}`}>
        <div className="col-span-3 truncate border-b border-rule px-3 py-1.5 text-muted md:col-span-1 md:border-b-0">
          {scopeLabel}
          {current && <> · <span className="font-medium text-ink">{nameOf(current)}</span></>}
          {' · '}<span className="font-mono tnum text-ink">{scope.count}</span> transaction{scope.count === 1 ? '' : 's'}
        </div>
        {lines.map((l, i) => (
          <div
            key={l.label}
            className={`flex min-w-0 items-baseline justify-between gap-2 px-3 py-1.5 ${i > 0 ? 'border-l border-rule' : ''} md:border-l md:border-rule ${l.net ? '' : TINT[l.tone] ?? ''}`}
          >
            <span className="shrink-0 text-xs text-muted">{l.label}</span>
            <span className={`truncate font-mono tnum ${l.net ? 'font-medium' : ''} ${l.cents === 0 ? 'text-muted' : TONE[l.tone]}`}>
              {formatMoney(l.cents, { showSign: true })}
            </span>
          </div>
        ))}
      </div>
      {share && (
        <p className="mt-1.5 text-xs text-muted">
          {nameOf(current)} is <span className="font-mono tnum text-ink">{share.pct}%</span> of all money {share.direction} on this {accountType === 'CREDIT_CARD' ? 'card' : 'account'}
          {scopeLabel !== 'All time' ? ` in ${scopeLabel}` : ''}.
        </p>
      )}
    </div>
  );
}
