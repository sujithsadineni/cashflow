import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatShortDate } from '../../../api';
import { txnName } from '../../../lib/transactions/txn-name';
import { accountArt } from '../../../lib/cards/account-art';
import { ShowMore } from '../../ui/DetailDialog';
import { MerchantAvatar } from '../../ui/MerchantAvatar';
import { Segmented } from '../../ui/Form';
import { Dropdown } from '../../ui/Dropdown';
import { MONTHS, signed } from '../../../lib/overview/explorer';

/**
 * The year explorer the small Overview cards share (D284, D285): month bars,
 * a comparison with the year before, and kind and account tiles that filter
 * one grid of small cards, each opening its transaction. Cashback (money
 * in) and Fees & Interest (money out) each bring their kinds, their words
 * and how a row is titled; everything else is here.
 *
 * Amounts are coloured by their own sign, so a refunded fee shows as money
 * back inside a card about money out. The bars are one series in the card's
 * colour (`tone`), sized by how much moved, with no legend; a stacked chart
 * would need a hue per kind, and the design system keeps its two saturated
 * colours for money in and out.
 *
 * Every endpoint behind this returns { months[12] (per kind + total),
 * through_month, previous_year, cards, items, years }.
 *
 * `signed` on MonthBars and Comparison (D295, Savings): a total that can go
 * either way. Each bar takes the colour of its own sign, and the year before
 * is compared as it stands, not by size, so losing more never reads as ahead.
 */

const sum = (items) => items.reduce((a, i) => a + i.amount_cents, 0);
// Money out is red where it's spending (fees); a card about moving money (Investment, To India) keeps it ink.
const toneOf = (c, outTone = 'spend') => (c < 0 ? (outTone === 'ink' ? 'text-ink' : 'text-spend') : 'text-earn');
const fillOf = (c, outTone = 'spend') => (c < 0 ? (outTone === 'ink' ? 'bg-ink/60' : 'bg-spend') : 'bg-earn');

/** Every year on file. A phone has no room beside the title for four tabs, so it gets a menu. */
export function YearSwitch({ years, year, onChange }) {
  return (
    <>
      <span className="hidden sm:block">
        <Segmented value={year} onChange={onChange} options={years.map((y) => ({ value: y, label: String(y) }))} />
      </span>
      {/* The app's own menu on a phone, not the browser's <select> (D312). */}
      <span className="sm:hidden">
        <Dropdown quiet value={String(year)} onChange={(v) => onChange(Number(v))} aria-label="Year"
          options={years.map((y) => ({ value: String(y), label: String(y) }))} />
      </span>
    </>
  );
}

/** Twelve months as bars; months still to come are a faint stub. Hover for a month's kinds, tap to filter by it. */
export function MonthBars({ months, through, kinds, tone = 'earn', signed: bySign = false, picked, onPick, empty = 'Nothing this year.' }) {
  const [hovered, setHovered] = useState(null);
  const size = (m) => Math.abs(m.total);
  const max = Math.max(1, ...months.map(size));
  const peak = months.reduce((best, m, i) => (size(m) > size(months[best]) ? i : best), 0);
  const pickedAt = months.findIndex((m) => m.month === picked);
  const shown = hovered ?? (pickedAt >= 0 ? pickedAt : null);
  const tip = hovered !== null ? months[hovered] : null;
  const BARS = { spend: ['bg-spend', 'bg-spend/55', 'bg-spend/20'], ink: ['bg-ink/80', 'bg-ink/45', 'bg-ink/15'], earn: ['bg-earn', 'bg-earn/55', 'bg-earn/20'] };
  const barOf = (m) => (bySign ? BARS[m.total < 0 ? 'spend' : 'earn'] : BARS[tone] ?? BARS.earn);

  if (months.every((m) => m.total === 0)) return <p className="py-8 text-center text-sm text-faint">{empty}</p>;

  return (
    <div className="relative">
      <div className="flex h-44 items-end gap-1 sm:gap-2" onMouseLeave={() => setHovered(null)}>
        {months.map((m, i) => {
          const future = i >= through;
          const lit = pickedAt < 0 || i === pickedAt || i === hovered;
          const label = i === peak || i === shown;
          const bar = barOf(m);
          return (
            <button
              key={m.month}
              type="button"
              disabled={future || m.total === 0}
              onClick={() => onPick(m.month)}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              aria-pressed={i === pickedAt}
              aria-label={`${MONTHS[i]}: ${signed(m.total)}`}
              className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end outline-none disabled:cursor-default"
            >
              {label && !future && m.total !== 0 && (
                <span className="mb-1 font-mono text-[10px] text-muted tnum sm:text-[11px]">{bySign && m.total < 0 ? '−' : ''}{formatMoney(Math.abs(m.total), { compact: true })}</span>
              )}
              <span
                className={`w-full max-w-9 rounded-t-[4px] transition-colors ${
                  future ? 'h-px bg-rule' : i === pickedAt || i === hovered ? bar[0] : lit ? bar[1] : bar[2]
                }`}
                style={future ? undefined : { height: `${Math.max((size(m) / max) * 100, m.total ? 2 : 0.5)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1 border-t border-rule pt-1.5 sm:gap-2">
        {months.map((m, i) => (
          <span key={m.month} className={`min-w-0 flex-1 text-center text-[10px] sm:text-xs ${i === shown ? 'font-medium text-ink' : 'text-faint'}`}>
            <span className="sm:hidden">{MONTHS[i][0]}</span>
            <span className="hidden sm:inline">{MONTHS[i]}</span>
          </span>
        ))}
      </div>
      {tip && (
        <div
          className={`pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-lg border border-rule bg-raised px-3 py-2 text-xs shadow-md ${
            hovered < 2 ? '' : hovered > 9 ? '-translate-x-full' : '-translate-x-1/2'
          }`}
          style={{ left: `${((hovered < 2 ? hovered : hovered > 9 ? hovered + 1 : hovered + 0.5) / 12) * 100}%` }}
        >
          <div className="flex justify-between gap-4 font-medium text-ink">
            <span>{MONTHS[hovered]} {tip.month.slice(0, 4)}</span>
            <span className="font-mono tnum">{signed(tip.total)}</span>
          </div>
          {kinds.filter((k) => tip[k.key]).map((k) => (
            <div key={k.key} className="mt-0.5 flex justify-between gap-4 text-muted">
              <span>{k.label}</span>
              <span className="font-mono tnum">{signed(tip[k.key])}</span>
            </div>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>By month</caption>
        <tbody>
          {months.slice(0, through).map((m, i) => (
            <tr key={m.month}><th scope="row">{MONTHS[i]}</th><td>{signed(m.total)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The year against the one before, to the same month. `verb` reads after the
 * year ("had brought back", "had cost"); money in is ahead or behind, money
 * out is more or less.
 */
export function Comparison({ data, verb, tone = 'earn', signed: bySign = false }) {
  const prev = data.previous_year;
  if (!prev || prev.total_cents === 0) return null;
  const partial = data.through_month < 12;
  const raw = partial ? prev.to_date_cents : prev.total_cents;
  const before = bySign ? raw : Math.abs(raw);
  const diff = (bySign ? data.total_cents : Math.abs(data.total_cents)) - before;
  const words = tone === 'earn' || bySign ? ['ahead', 'behind'] : ['more', 'less'];
  // Only money in or spending is better one way; moving money (tone 'ink') is neither.
  const good = bySign ? diff > 0 : tone === 'spend' ? diff < 0 : tone === 'earn' && diff > 0;
  return (
    <p className="mt-3 text-sm text-muted">
      {partial ? `By the end of ${MONTHS[data.through_month - 1]}, ` : ''}
      {prev.year} {verb} <span className="font-mono text-ink tnum">{bySign ? signed(before) : formatMoney(before)}</span>
      {diff !== 0 && (
        <>
          {' '}— this year is{' '}
          <span className={`font-mono tnum ${good ? 'text-earn' : tone === 'spend' ? 'text-spend' : 'text-ink'}`}>{formatMoney(Math.abs(diff))} {diff > 0 ? words[0] : words[1]}</span>
        </>
      )}
      .
    </p>
  );
}

/** A card the size of a fingertip: its photo, else its bank's colours. */
export function CardThumb({ card, small = false }) {
  const art = accountArt(card);
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] shadow-sm ring-1 ring-rule ${small ? 'h-[18px] w-[26px]' : 'h-6 w-9'}`} style={art.style} aria-hidden="true">
      {art.logo && <img src={art.logo} alt="" className={`${small ? 'h-2' : 'h-3'} w-auto opacity-90`} />}
    </span>
  );
}

/**
 * Kind and account tiles over one grid; each set of tiles shows its figures
 * with the other filters applied, and a tile left with nothing dims.
 *
 *   kinds        [{ key, label, ink? }] in display order; kinds with nothing all year aren't shown;
 *                `ink` for a kind that's neither in nor out (Zelle between you)
 *   noun         ['credit', 'credits'] — what one row is called
 *   accountExtra card => node under its amount (cashback's "waiting")
 *   grouped      { kind: label } — kinds that arrive a line a month per account
 *                (interest), shown as one card per account that opens into its months
 *   describe     (item, card) => { title, icon?, sub?, opens?, onOpen?, openTitle?, tone? } for a row, over the default
 *   kindAmount   (kind, rows) => cents for a kind tile, over their sum (Zelle's between-you)
 *   facet        the second row of tiles, over the accounts (D288: Zelle's people):
 *                { label, hint, field (the row's key for it), limit, tiles: [{ key, name, thumb, amount?(rows) }] }
 */
export function Explorer({ data, kinds, filter, toggle, clear, onClose, noun, accountExtra, grouped = {}, describe, outTone = 'spend', kindAmount, facet: given }) {
  const [allTiles, setAllTiles] = useState(false);
  const facet = given ?? {
    label: 'Account',
    hint: 'an account',
    field: 'account_id',
    tiles: data.cards
      .filter((c) => data.items.some((i) => i.account_id === c.account_id) || accountExtra?.(c))
      .map((c) => ({ key: c.account_id, name: c.name, thumb: <CardThumb card={c} />, extra: accountExtra?.(c) })),
  };
  const matches = (i, except) =>
    (except === 'kind' || !filter.kind || i.kind === filter.kind)
    && (except === 'account' || !filter.account || i[facet.field] === filter.account)
    && (except === 'month' || !filter.month || i.posted_date.startsWith(filter.month));
  const shownKinds = kinds.filter((k) => data.items.some((i) => i.kind === k.key));
  // Past `limit`, the rest wait behind "Show all"; a chosen tile always shows.
  const tiles = !facet.limit || allTiles || facet.tiles.length <= facet.limit
    ? facet.tiles
    : facet.tiles.filter((t, i) => i < facet.limit || t.key === filter.account);
  const forKinds = data.items.filter((i) => matches(i, 'kind'));
  const forAccounts = data.items.filter((i) => matches(i, 'account'));
  const results = data.items.filter((i) => matches(i));
  const cardOf = new Map(data.cards.map((c) => [c.account_id, c]));
  const active = filter.kind || filter.account || filter.month;
  const yearAbs = Math.max(1, data.items.reduce((a, i) => a + Math.abs(i.amount_cents), 0));
  const count = (n) => `${n} ${n === 1 ? noun[0] : noun[1]}`;
  const kindLabel = (key) => kinds.find((k) => k.key === key)?.label ?? key;

  return (
    <div className="mt-6">
      <SubLabel>Kind</SubLabel>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:grid sm:overflow-visible" style={{ gridTemplateColumns: `repeat(${shownKinds.length <= 5 ? shownKinds.length : Math.ceil(shownKinds.length / 2)}, minmax(0, 1fr))` }}>
        {shownKinds.map((k) => {
          const mine = forKinds.filter((i) => i.kind === k.key);
          const cents = kindAmount ? kindAmount(k.key, mine) : sum(mine);
          return (
            <Tile key={k.key} selected={filter.kind === k.key} empty={mine.length === 0} onClick={() => toggle('kind', k.key)} className="min-w-[8.5rem] sm:min-w-0">
              <div className="truncate text-xs text-muted" title={k.label}>{k.label}</div>
              <div className={`mt-1 font-mono text-base font-semibold tnum ${k.ink ? 'text-ink' : toneOf(cents, outTone)}`}>{mine.length ? signed(cents) : '—'}</div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px] text-faint">{count(mine.length)}</span>
                <span className="h-1 flex-1 rounded-full bg-band">
                  <span className={`block h-1 rounded-full ${k.ink ? 'bg-ink/60' : fillOf(cents, outTone)}`} style={{ width: `${Math.min(100, (Math.abs(cents) / yearAbs) * 100)}%` }} />
                </span>
              </div>
            </Tile>
          );
        })}
      </div>

      <SubLabel className="mt-5">{facet.label}</SubLabel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {tiles.map((t) => {
          const mine = forAccounts.filter((i) => i[facet.field] === t.key);
          const cents = sum(mine);
          return (
            <Tile key={t.key} selected={filter.account === t.key} empty={mine.length === 0} onClick={() => toggle('account', t.key)} className="px-2 py-2">
              <div className="truncate text-xs text-ink" title={t.name}>{t.name}</div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                {t.thumb}
                <div className="min-w-0 text-right leading-tight">
                  {t.amount ? t.amount(mine) : <div className={`font-mono text-xs tnum ${toneOf(cents, outTone)}`}>{mine.length ? signed(cents) : '—'}</div>}
                  {t.extra}
                </div>
              </div>
            </Tile>
          );
        })}
      </div>
      {tiles.length < facet.tiles.length || allTiles ? (
        <button onClick={() => setAllTiles(!allTiles)} className="mt-2 text-xs text-muted underline-offset-4 hover:text-ink hover:underline">
          {allTiles ? 'Show fewer' : `Show all ${facet.tiles.length}`}
        </button>
      ) : null}

      {active ? (
        <div className="mt-5 border-t border-rule pt-4" aria-live="polite">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-sm text-muted">
              <span className="text-ink">
                {[filter.kind && kindLabel(filter.kind), filter.account && facet.tiles.find((t) => t.key === filter.account)?.name, filter.month && `${MONTHS[Number(filter.month.slice(5)) - 1]} ${filter.month.slice(0, 4)}`].filter(Boolean).join(' · ')}
              </span>
              {' · '}{count(results.length)} · <span className="font-mono tnum">{signed(sum(results))}</span>
            </p>
            <button onClick={clear} className="shrink-0 text-sm text-muted transition-colors hover:text-ink" aria-label="Clear the filters">Clear ✕</button>
          </div>
          {results.length
            ? <Results items={results} cardOf={cardOf} onClose={onClose} grouped={grouped} describe={describe} kindLabel={kindLabel} outTone={outTone} />
            : <p className="text-sm text-faint">Nothing matches all of these.</p>}
        </div>
      ) : (
        <p className="mt-4 text-sm text-faint">Pick a month, a kind or {facet.hint} to see the {noun[1]} behind it.</p>
      )}
    </div>
  );
}

function SubLabel({ children, className = '' }) {
  return <div className={`mb-2 text-xs font-medium text-faint ${className}`}>{children}</div>;
}

/** A filter tile: pressed while chosen; dimmed when the other filters leave it nothing. */
function Tile({ selected, empty, onClick, className = '', children }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={empty && !selected}
      onClick={onClick}
      className={`rounded-lg border p-2.5 text-left transition-colors disabled:cursor-default disabled:opacity-40 ${
        selected ? 'border-ink/50 bg-band ring-1 ring-ink/20' : 'border-rule hover:border-rule-str hover:bg-band'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** The rows as small cards, newest first; a grouped kind is one card per account. */
function Results({ items, cardOf, onClose, grouped, describe, kindLabel, outTone }) {
  const navigate = useNavigate();
  const open = (id) => { onClose(); navigate(`/transactions?txn=${id}`); };
  const groups = new Map();
  const single = [];
  for (const i of items) {
    if (grouped[i.kind]) {
      const key = `${i.kind}-${i.account_id}`;
      if (!groups.has(key)) groups.set(key, { kind: i.kind, rows: [] });
      groups.get(key).rows.push(i);
    } else single.push(i);
  }
  const cards = [
    ...single.map((i) => ({ key: `i-${i.id}`, item: i, date: i.posted_date })),
    ...[...groups].map(([key, g]) => ({ key: `g-${key}`, group: g, date: g.rows[0].posted_date })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <ShowMore
      key={items.length}
      items={cards}
      limit={12}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
      render={(c) => (c.group
        ? <GroupCard key={c.key} label={grouped[c.group.kind]} rows={c.group.rows} card={cardOf.get(c.group.rows[0].account_id)} open={open} outTone={outTone} />
        : <RowCard key={c.key} item={c.item} card={cardOf.get(c.item.account_id)} open={open} outTone={outTone} view={{ title: txnName(c.item) ?? kindLabel(c.item.kind), opens: true, ...describe?.(c.item, cardOf.get(c.item.account_id)) }} />)}
    />
  );
}

function RowCard({ item, card, open, view, outTone }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {view.icon ?? <MerchantAvatar merchant={item.merchant} description={item.description} txnType={item.txn_type} amountCents={item.amount_cents} categoryName={item.category_name} clickable={false} size={22} />}
        <span className="min-w-0 truncate text-sm text-ink">{view.title}</span>
      </div>
      <div className="mt-1.5 truncate text-xs text-faint">{view.sub ?? formatShortDate(item.posted_date)}</div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted">{card?.name ?? 'Account'}</span>
        <span className={`shrink-0 font-mono text-sm tnum ${view.tone ?? toneOf(item.amount_cents, outTone)}`}>{signed(item.amount_cents)}</span>
      </div>
    </>
  );
  // Something that isn't a transaction but can still be opened (a gift card, D330).
  if (view.onOpen) {
    return (
      <button type="button" onClick={view.onOpen} title={view.openTitle} className="group rounded-lg border border-rule p-2.5 text-left transition-colors hover:border-rule-str hover:bg-band">
        {body}
      </button>
    );
  }
  if (!view.opens) return <div className="rounded-lg border border-rule p-2.5">{body}</div>;
  return (
    <button type="button" onClick={() => open(item.id)} title="Open this transaction" className="group rounded-lg border border-rule p-2.5 text-left transition-colors hover:border-rule-str hover:bg-band">
      {body}
    </button>
  );
}

function GroupCard({ label, rows, card, open, outTone }) {
  const [expanded, setExpanded] = useState(false);
  const total = sum(rows);
  return (
    <div className={`rounded-lg border border-rule p-2.5 ${expanded ? 'col-span-full' : ''}`}>
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="w-full text-left">
        <div className="flex items-center gap-2">
          {card && <CardThumb card={card} small />}
          <span className="min-w-0 truncate text-sm text-ink">{label}</span>
          <span className="ml-auto text-xs text-faint">{expanded ? '▴' : '▾'}</span>
        </div>
        <div className="mt-1.5 text-xs text-faint">{rows.length} {rows.length === 1 ? 'month' : 'months'}</div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted">{card?.name ?? 'Account'}</span>
          <span className={`shrink-0 font-mono text-sm tnum ${toneOf(total, outTone)}`}>{signed(total)}</span>
        </div>
      </button>
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-rule pt-2 sm:grid-cols-4 md:grid-cols-6">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => open(r.id)} title="Open this transaction"
              className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-band">
              <span className="text-muted">{formatShortDate(r.posted_date)}</span>
              <span className={`font-mono tnum ${toneOf(r.amount_cents, outTone)}`}>{signed(r.amount_cents)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
