import { motion } from 'motion/react';
import { formatMoney } from '../../api';
import { aprText, longDate, warningSentences } from '../../balance-transfer';
import { countdownDaysBetween, countdownFor, nextDeadline, projection } from '../../loan-countdown';

/**
 * The Glass design's Loans (D240): the "Countdown" direction the owner
 * picked from the mockups, after Live Activities. Built around time,
 * because for a 0% transfer the date is the decision.
 *
 *   GlassLoansList   the nearest 0% deadline as a Live Activity banner, then
 *                    each loan as a track from start to payoff with today
 *                    on it, its countdown (orange when a 0% end is close),
 *                    what's owed and the monthly pace
 *   GlassLoanSheet   one loan: the countdown, owed and monthly pace, the
 *                    balance path to zero at that pace, and the facts
 *
 * Everything is read off the loan (loan-countdown.js); no "percent paid".
 */

const TYPE_COLOR = { balance_transfer: '#AF52DE', credit_card: '#5856D6', car: '#30B0C7', home: '#34C759', other: '#FF9500' };
const colorOf = (loan) => TYPE_COLOR[loan.loan_type] ?? TYPE_COLOR.other;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const settle = { type: 'spring', bounce: 0, duration: 0.6 };

function Ring({ size, stroke, share, color, track }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.max(share, 0.02)) }} transition={{ ...settle, duration: 1 }}
      />
    </svg>
  );
}

/** What the big number counts, in words. */
function unitLine(c) {
  if (c.kind === 'bt') return `days left at ${aprText(c.promoAprBps)}${c.afterAprBps != null ? ` · then ${aprText(c.afterAprBps)}` : ''}`;
  if (c.kind === 'schedule') return `${c.unit} · last one ${month(c.end)}`;
  return `days left · due ${month(c.end)}`;
}

/** The nearest 0% (or payoff) deadline, as a Live Activity. */
function LiveBanner({ loan, c }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={settle}
      className="flex items-center gap-4 rounded-[28px] border border-white/10 bg-black px-5 py-4 text-white shadow-[0_10px_30px_-12px_rgb(0_0_0/0.5)]"
    >
      <Ring size={44} stroke={5} share={c.timeShare} color="#FF9F0A" track="rgb(255 255 255 / 0.2)" />
      <div className="min-w-0">
        <p className="text-xs text-white/65">Next {c.kind === 'bt' ? `${aprText(c.promoAprBps)} deadline` : 'deadline'}</p>
        <p className="truncate font-semibold">{loan.name}</p>
        {c.perMonthCents != null && <p className="text-xs text-white/65"><span className="tnum">{formatMoney(c.perMonthCents)}</span>/mo clears it</p>}
      </div>
      <div className="ml-auto text-right">
        <p className="text-3xl font-bold leading-none tracking-[-0.03em] text-[#FF9F0A] tnum">{c.count}</p>
        <p className="mt-1 text-xs text-white/65">days left</p>
      </div>
    </motion.div>
  );
}

function Track({ c, color }) {
  const at = `${c.timeShare * 100}%`;
  return (
    <div className="relative mt-3 h-7" aria-hidden="true">
      <span className="absolute inset-x-0 top-[11px] h-1 rounded-full bg-band" />
      <motion.span
        className="absolute left-0 top-[11px] h-1 rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }} animate={{ width: at }} transition={{ ...settle, duration: 0.9 }}
      />
      <motion.span
        className="absolute top-[5px] -ml-2 size-4 rounded-full bg-raised shadow-[0_0_0_3px_var(--color-info)]"
        initial={{ left: 0 }} animate={{ left: at }} transition={{ ...settle, duration: 0.9 }}
      />
      <span className="absolute right-0 top-0.5 h-[22px] w-0.5 rounded-full bg-[#FF9F0A]" />
      <span className="absolute inset-x-0 top-7 flex justify-between text-[0.6875rem] text-faint">
        <span>{month(c.start)}</span><span>Today</span><span>{month(c.end)}</span>
      </span>
    </div>
  );
}

export function GlassLoansList({ loans, onOpen }) {
  const today = todayISO();
  const next = nextDeadline(loans, today);
  return (
    <div className="space-y-3">
      {next && <LiveBanner loan={next.loan} c={next.c} />}
      {loans.map((loan, i) => {
        const c = countdownFor(loan, today);
        return (
          <motion.button
            key={loan.id}
            type="button"
            onClick={() => onOpen(loan)}
            initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ ...settle, delay: 0.06 * (i + 1) }}
            whileTap={{ scale: 0.98 }}
            className="block w-full rounded-[18px] bg-raised px-5 py-4 text-left shadow-[0_1px_2px_rgb(0_0_0/0.05),0_8px_24px_-16px_rgb(0_0_0/0.2)] transition-colors hover:bg-band"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{loan.name}</p>
                {loan.lender && <p className="truncate text-sm text-muted">{loan.lender}</p>}
              </div>
              {c && (
                <p className={`shrink-0 text-2xl font-bold tracking-[-0.03em] tnum ${c.urgent ? 'text-[#FF9F0A]' : 'text-ink'}`}>
                  {c.count} <span className="text-sm font-medium tracking-normal text-muted">{c.unit}</span>
                </p>
              )}
            </div>
            {c && <Track c={c} color={colorOf(loan)} />}
            <div className={`flex justify-between text-sm text-muted ${c ? 'mt-6' : 'mt-2'}`}>
              <span>Owed <span className="font-semibold text-spend tnum">{formatMoney(loan.effective_balance_cents)}</span></span>
              {c?.perMonthCents != null && <span><span className="font-semibold text-ink tnum">{formatMoney(c.perMonthCents)}</span>/mo</span>}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

/** The balance so far, and the dashed path to zero at the monthly pace. */
function PathChart({ c, color }) {
  const today = todayISO();
  const W = 560;
  const H = 210;
  const P = 30;
  const span = Math.max(1, countdownDaysBetween(c.start, c.end));
  const top = Math.max(c.startBalanceCents ?? 0, c.balanceCents, 1);
  const x = (iso) => P + (Math.min(span, Math.max(0, countdownDaysBetween(c.start, iso))) / span) * (W - P * 2);
  const y = (cents) => H - P - (Math.max(0, cents) / top) * (H - P * 2);
  const path = projection(c, today);
  const line = path.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.cents).toFixed(1)}`).join(' ');
  const nowX = x(today);
  const nowY = y(c.balanceCents);
  const endX = x(c.end);
  return (
    <div className="mt-4 rounded-2xl bg-raised px-3 pb-2 pt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Balance path to zero">
        {line && <path d={`${line} L${x(path.at(-1).date)} ${H - P} L${nowX} ${H - P} Z`} fill={color} opacity="0.1" />}
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--color-rule)" />
        <line x1={endX} y1={P - 8} x2={endX} y2={H - P} stroke="#FF9F0A" strokeDasharray="3 4" />
        <text x={endX} y={P - 12} textAnchor="end" fontSize="11" fill="#FF9F0A">{c.kind === 'bt' ? `${aprText(c.promoAprBps)} ends` : c.kind === 'schedule' ? 'Last payment' : 'Due'} {month(c.end)}</text>
        {c.startBalanceCents != null && (
          <motion.path d={`M${x(c.start)} ${y(c.startBalanceCents)} L${nowX} ${nowY}`} stroke={color} strokeWidth="3.5" fill="none" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
        )}
        {line && (
          <motion.path d={line} stroke={color} strokeWidth="2.5" fill="none" strokeDasharray="5 6" strokeLinecap="round" opacity="0.8"
            initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} transition={{ duration: 0.8, delay: 0.3 }} />
        )}
        <circle cx={nowX} cy={nowY} r="6" fill="var(--color-raised)" stroke="var(--color-info)" strokeWidth="3" />
        <text x={Math.min(nowX + 10, W - 120)} y={nowY - 10} fontSize="11" fill="var(--color-muted)">Today · {formatMoney(c.balanceCents)}</text>
        {nowX - P > 70 && <text x={P} y={H - 9} fontSize="11" fill="var(--color-faint)">{month(c.start)}</text>}
      </svg>
      {c.perMonthCents != null && (
        <div className="flex flex-wrap gap-4 px-1 pb-1 text-xs text-muted">
          {c.startBalanceCents != null && <span className="flex items-center gap-1.5"><i className="inline-block h-[3px] w-3.5 rounded-full" style={{ backgroundColor: color }} />So far</span>}
          <span className="flex items-center gap-1.5"><i className="inline-block h-[3px] w-3.5 rounded-full opacity-60" style={{ backgroundColor: color }} />At {formatMoney(c.perMonthCents)}/mo</span>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, children, tone }) => (
  <div className="flex justify-between gap-3 border-t border-rule px-4 py-3 first:border-t-0">
    <span className="text-ink">{label}</span>
    <span className={`text-right tnum ${tone ?? 'text-muted'}`}>{children}</span>
  </div>
);

function Facts({ loan, c }) {
  if (c?.kind === 'bt') {
    const bt = loan.bt;
    const promo = bt.promos?.[0];
    return (
      <>
        <p className="mx-1 mb-1.5 mt-5 text-sm text-muted">The transfer</p>
        <div className="overflow-hidden rounded-2xl bg-raised">
          {bt.transferred_cents > 0 && <Row label="Transferred">{formatMoney(bt.transferred_cents)}{bt.since ? ` · ${longDate(bt.since)}` : ''}</Row>}
          <Row label="Transfer fee">{formatMoney(bt.fees_cents)}</Row>
          <Row label="Paid on the card since" tone="text-earn">{formatMoney(bt.paid_cents)}</Row>
          {c.afterAprBps != null && <Row label={`After ${month(c.end)}`}>{aprText(c.afterAprBps)} APR</Row>}
        </div>
        {promo?.label && <p className="mx-1 mt-2 text-xs text-muted">From the card’s statement: {promo.label}{promo.offer_id ? ` · ${promo.offer_id}` : ''}.</p>}
        {warningSentences(bt).map((w) => (
          <p key={w.kind} className={`mx-1 mt-2 text-xs ${w.tone === 'spend' ? 'text-spend' : 'text-muted'}`}>
            {w.parts.map((p, i) => (typeof p === 'string' ? p : <span key={i} className="tnum">{formatMoney(p.cents)}</span>))}
          </p>
        ))}
        <p className="mx-1 mt-2 text-xs text-faint">Owed now is the whole card’s statement balance: fees and any purchases on the card are part of it.</p>
      </>
    );
  }
  return (
    <>
      <p className="mx-1 mb-1.5 mt-5 text-sm text-muted">The loan</p>
      <div className="overflow-hidden rounded-2xl bg-raised">
        {loan.monthly_payment_cents != null && <Row label="Monthly payment">{formatMoney(loan.monthly_payment_cents)}</Row>}
        {c?.kind === 'schedule' && <Row label="Payments">{c.made} made · {c.count} left</Row>}
        {c?.kind === 'deadline' && <Row label="Needed each month">{formatMoney(c.perMonthCents)}</Row>}
        {loan.start_date && <Row label="Started">{longDate(loan.start_date)}</Row>}
        {c && <Row label={c.kind === 'schedule' ? 'Last payment' : 'Pay off by'}>{longDate(c.end)}</Row>}
      </div>
    </>
  );
}

export function GlassLoanSheet({ loan, onClose, onSchedule }) {
  const c = countdownFor(loan, todayISO());
  const color = colorOf(loan);
  return (
    <div className="modal-scrim fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={loan.name}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto border border-rule bg-raised p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.015em] text-ink">{loan.name}</h3>
            <p className="text-sm text-muted">{loan.lender}{c?.kind === 'bt' ? ' · balance transfer' : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-full bg-band text-muted transition-colors hover:text-ink">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
          </button>
        </div>

        {c ? (
          <>
            <motion.div className="text-center" initial={{ opacity: 0, scale: 0.96, filter: 'blur(8px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={settle}>
              <p className={`text-[4.5rem] font-bold leading-none tracking-[-0.05em] tnum ${c.urgent ? 'text-[#FF9F0A]' : 'text-ink'}`}>{c.count}</p>
              <p className="mt-2 text-muted">{unitLine(c)}</p>
            </motion.div>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
              <span className="rounded-full bg-raised px-3.5 py-2">Owed <b className="font-semibold text-spend tnum">{formatMoney(c.balanceCents)}</b></span>
              {c.perMonthCents != null && <span className="rounded-full bg-raised px-3.5 py-2"><b className="font-semibold tnum">{formatMoney(c.perMonthCents)}</b> a month</span>}
            </div>
            <PathChart c={c} color={color} />
          </>
        ) : (
          <p className="text-3xl font-bold tracking-[-0.03em] text-spend tnum">{formatMoney(loan.effective_balance_cents)}</p>
        )}

        <Facts loan={loan} c={c} />

        {onSchedule && (
          <button type="button" onClick={onSchedule} className="mx-auto mt-5 block text-sm text-info underline-offset-4 hover:underline">
            Month by month
          </button>
        )}
      </div>
    </div>
  );
}
