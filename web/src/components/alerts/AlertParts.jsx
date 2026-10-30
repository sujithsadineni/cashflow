import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { formatMoney } from '../../api';
import { usePlacement, useOutsideClose } from '../../hooks/use-popover';
import { PopoverPanel } from '../ui/PopoverPanel';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { MiniCard } from '../settings/apple/SplitList';
import { DUE_SOON_DAYS } from '../../lib/alerts/alert-feed';

/**
 * The pieces of the Alerts dashboard (D318): the four tiles and the alert card with its ring, its action, its
 * "…" menu (snooze, dismiss, mark paid) and, for a statement, a drop target.
 */

const TILE = {
  pay: { label: 'Pay', tint: 'bg-spend/10', ink: 'text-spend', ring: 'ring-spend/50', icon: <path d="M2.5 5.5h11v7h-11zM2.5 8h11" /> },
  upload: { label: 'Upload', tint: 'bg-info/10', ink: 'text-info', ring: 'ring-info/50', icon: <path d="M8 11V3.5M5 6.5l3-3 3 3M3 12.5h10" /> },
  bills: { label: 'Bills', tint: 'bg-warn/10', ink: 'text-warn', ring: 'ring-warn/50', icon: <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M3.5 3v2.5H6" /> },
  review: { label: 'Review', tint: 'bg-band', ink: 'text-ink', ring: 'ring-rule-str', icon: <path d="m3.5 8.5 3 3 6-7" /> },
};

// A card's terms changed (D349): an APR, so a percent sign; it counts under no tile.
const PERCENT = <path d="M12 4 4 12M5 4.5a.5.5 0 1 0 0 .01M11 11.5a.5.5 0 1 0 0 .01" />;

/** The four tiles: what to pay, upload, chase and match. Tapping one shows only its cards. */
export function Tiles({ totals, active, onPick, still }) {
  const value = {
    pay: totals.pay.count ? formatMoney(totals.pay.cents) : 'Nothing',
    upload: totals.upload.count ? `${totals.upload.count}` : 'None',
    bills: totals.bills.count ? `${totals.bills.count}` : 'None',
    review: totals.review.count ? `${totals.review.count}` : 'None',
  };
  const note = {
    pay: totals.pay.count ? `${totals.pay.count} ${totals.pay.count === 1 ? 'bill' : 'bills'} due` : 'due soon',
    upload: totals.upload.count === 1 ? 'statement late' : 'statements late',
    bills: totals.bills.cents ? `${formatMoney(totals.bills.cents)} not charged` : 'not charged',
    review: 'to match or review',
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Object.entries(TILE).map(([key, t], i) => {
        const on = active === key;
        const empty = !totals[key].count;
        return (
          <motion.button
            key={key} type="button" onClick={() => onPick(on ? null : key)} aria-pressed={on}
            initial={still ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.4, delay: 0.04 * i }}
            whileHover={still ? undefined : { y: -2 }} whileTap={still ? undefined : { scale: 0.98 }}
            className={`flex min-h-[7.5rem] flex-col rounded-[20px] p-4 text-left transition-shadow ${t.tint} ${on ? `ring-2 ${t.ring}` : ''} ${empty ? 'opacity-60' : ''}`}
          >
            <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${t.ink}`}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{t.icon}</svg>
              {t.label}
            </span>
            <span className="mt-auto text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink tnum">{value[key]}</span>
            <span className="text-[12px] text-muted">{note[key]}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** Days left as a ring: fuller as the day nears, all red once late. */
export function Ring({ days, urgent }) {
  if (days == null) return null;
  const late = days < 0;
  const share = late ? 1 : Math.max(0.08, 1 - Math.min(days, 30) / 30);
  const r = 17; const c = 2 * Math.PI * r;
  // Amber in a bill's last few days (D361), red once it's urgent or late.
  const tone = late || urgent ? 'text-spend' : days <= DUE_SOON_DAYS ? 'text-warn' : 'text-info';
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center" aria-label={late ? `${-days} days late` : `${days} days left`}>
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="3.5" className="text-band" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - share)} className={tone} />
      </svg>
      <span className={`absolute text-[12px] font-semibold tnum ${tone}`}>{late ? `${-days}d` : days === 0 ? 'now' : `${days}d`}</span>
    </span>
  );
}

/** "…": snooze a day, three days or a week, mark a card bill paid, or dismiss. */
function MoreMenu({ item, onAnswer }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const panel = useRef(null);
  const [place, placePanel] = usePlacement(open, trigger, 200, 'end');
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, [trigger, panel], close);
  const choices = [
    { label: 'Snooze for a day', body: { kind: 'snooze', days: 1 } },
    { label: 'Snooze for 3 days', body: { kind: 'snooze', days: 3 } },
    { label: 'Snooze for a week', body: { kind: 'snooze', days: 7 } },
    ...(item.tile === 'pay' ? [{ label: 'Mark as paid', body: { kind: 'paid' } }] : []),
    { label: item.tile === 'bills' ? "Dismiss: it's stopped" : 'Dismiss', body: { kind: 'dismiss' }, danger: true },
  ];
  return (
    <>
      <button ref={trigger} type="button" aria-label="More" aria-haspopup="menu" aria-expanded={open}
        onClick={() => { placePanel(); setOpen((o) => !o); }}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-band hover:text-ink">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="12.5" cy="8" r="1.4" /></svg>
      </button>
      {open && (
        <PopoverPanel place={place} panelRef={panel} className="apple-pane" role="menu" onKeyDown={(e) => e.key === 'Escape' && close()}>
          {choices.map((c) => (
            <button key={c.label} type="button" role="menuitem" onClick={() => { close(); onAnswer(item, c.body); }}
              className={`rounded-lg px-3 py-2 text-left text-[15px] hover:bg-info hover:text-white ${c.danger ? 'text-spend' : 'text-ink'}`}>
              {c.label}
            </button>
          ))}
        </PopoverPanel>
      )}
    </>
  );
}

/**
 * One alert as a card: the account's art or the merchant's logo, the
 * instruction, the amount large, where it stands, a ring of days, its one
 * action, and "…". A statement's card takes the PDF dropped on it.
 */
export function AlertCard({ item, account, onAnswer, onDropFile, busy, still, index }) {
  const [over, setOver] = useState(false);
  const drop = item.tile === 'upload' && onDropFile;
  const dropProps = drop ? {
    onDragOver: (e) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onDropFile(item, f); },
  } : {};
  return (
    <motion.li
      layout={!still}
      initial={still ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={still ? { opacity: 0 } : { opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', bounce: 0, duration: 0.4, delay: still ? 0 : 0.03 * index }}
      {...dropProps}
      className={`flex items-center gap-4 rounded-[20px] border bg-raised p-4 transition-colors ${over ? 'border-info bg-info/5' : 'border-rule'} ${busy ? 'opacity-60' : ''}`}
    >
      {account ? <MiniCard account={account} size="lg" />
        : item.merchant ? <span className="flex w-10 justify-center"><MerchantAvatar merchant={item.merchant} size={36} /></span>
        : (
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TILE[item.tile]?.tint ?? 'bg-band'} ${TILE[item.tile]?.ink ?? 'text-muted'}`} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{TILE[item.tile]?.icon ?? (['terms', 'usage', 'spend'].includes(item.kind) ? PERCENT : null)}</svg>
          </span>
        )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug text-ink line-clamp-2">{item.title}</span>
        {item.cents != null && <span className="block text-[22px] leading-tight font-semibold tracking-[-0.01em] text-ink tnum">{formatMoney(item.cents)}</span>}
        <span className={`block text-[13px] tnum ${item.urgent ? 'text-spend' : 'text-muted'}`}>
          {over ? 'Drop to upload it' : busy ? 'Reading…' : item.subtitle}{drop && !over && !busy ? ' · or drop the PDF here' : ''}
        </span>
      </span>
      <Ring days={item.days} urgent={item.urgent} />
      <span className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
        <Link to={item.action.to} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-[filter,background-color] ${item.urgent ? 'bg-info text-white hover:brightness-110' : 'bg-info/10 text-info hover:bg-info/15'}`}>
          {item.action.label}
        </Link>
        <MoreMenu item={item} onAnswer={onAnswer} />
      </span>
    </motion.li>
  );
}
