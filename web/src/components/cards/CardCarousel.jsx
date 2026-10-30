import { useEffect, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { useDesign } from '../../hooks/use-design';
import { api, formatMoney, formatShortDate, maskName } from '../../api';
import { backLimit, aprText, otherAprs, earnedLine } from '../../lib/cards/utilisation';
import { planLine } from '../../lib/cards/plans';
import { sharedPeople } from '../../lib/accounts/members';
import { bankBrandFor } from '../../lib/cards/bankBrands';
import { cardProductFor, productBackground } from '../../lib/cards/card-products';
import { ContactlessIcon, NetworkMark, SharedMark } from './CardMarks';
import bofaLogo from '../../assets/bank-logos/bofa.png';
import chaseLogo from '../../assets/bank-logos/chase.png';
import sofiLogo from '../../assets/bank-logos/sofi.png';
import { useNotify } from '../../hooks/use-notify';
import { Loading } from '../ui/Loading';

/**
 * A single card, centered, medium size — click the arrows to step
 * through your accounts one at a time, the way you'd flip through a
 * physical wallet rather than scan a shelf of cards at once.
 *
 * Card color is a per-tile personalization, not a third app-wide
 * accent — spend/earn stay the only meaning-carrying colors anywhere
 * else in the app.
 *
 * Two visual modes, deliberately different:
 *   - No custom image: we draw the whole card face (chip/bank icon,
 *     product name, issuer, network mark) since a flat color has no
 *     branding of its own — our synthetic elements are the only
 *     content there is.
 *   - A custom image (your own photo of the real card): the photo
 *     ALREADY shows the real chip, the real network logo, the real
 *     product name. Drawing our own copies on top just duplicates
 *     them and collides with whatever's actually printed there — that
 *     was the bug. So a photo gets only the two things it can't
 *     already show: your holder name and your actual last 4 digits,
 *     bold, with a solid dark backdrop bar guaranteeing they read
 *     against any photo.
 */

const PALETTE = [
  '#3B4B6B', '#6B4B8A', '#8A5A3B', '#4B6B5A',
  '#6B5A3B', '#3B6B7A', '#5A5A6B', '#7A4B4B',
];

const isCard = (account) => account.account_type === 'CREDIT_CARD';

function ChipIcon() {
  return (
    <svg width="36" height="26" viewBox="0 0 36 26" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="35" height="25" rx="4" fill="#D9C68A" fillOpacity="0.9" stroke="#00000022" />
      <line x1="12" y1="0.5" x2="12" y2="25.5" stroke="#00000030" />
      <line x1="24" y1="0.5" x2="24" y2="25.5" stroke="#00000030" />
      <line x1="0.5" y1="8.5" x2="35.5" y2="8.5" stroke="#00000030" />
      <line x1="0.5" y1="17.5" x2="35.5" y2="17.5" stroke="#00000030" />
    </svg>
  );
}

function BankMark() {
  return (
    <svg width="26" height="20" viewBox="0 0 20 16" fill="none" aria-hidden="true">
      <path d="M10 0L19 5H1L10 0Z" fill="currentColor" fillOpacity="0.85" />
      <rect x="2" y="6" width="2" height="8" fill="currentColor" fillOpacity="0.6" />
      <rect x="9" y="6" width="2" height="8" fill="currentColor" fillOpacity="0.6" />
      <rect x="16" y="6" width="2" height="8" fill="currentColor" fillOpacity="0.6" />
      <rect x="0" y="14.5" width="20" height="1.5" fill="currentColor" fillOpacity="0.85" />
    </svg>
  );
}

/* ------------------------------------------------------------------
   Bank-specific marks — the real logos, supplied directly by the
   owner (not fetched/hotlinked). Only ever shown for a CHECKING/
   SAVINGS account whose issuer matches a bank in bankBrands.js, and
   only as long as nothing has been manually customized (see CardFace
   below). A small white badge behind each logo guarantees contrast —
   without it, e.g. Chase's blue mark would nearly vanish on Chase's
   own blue card background.
   ------------------------------------------------------------------ */

const BRAND_LOGOS = { bofa: bofaLogo, chase: chaseLogo, sofi: sofiLogo };

function BrandMark({ brandKey }) {
  return (
    <div className="flex h-8 items-center justify-center rounded-md bg-white/95 px-2 shadow-sm">
      <img src={BRAND_LOGOS[brandKey]} alt="" className="h-6 w-auto max-w-20 object-contain" />
    </div>
  );
}

function ArrowButton({ direction, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Previous card' : 'Next card'}
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-rule bg-raised
                 text-ink transition-colors hover:bg-band disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg width="9" height="14" viewBox="0 0 9 14" fill="none" aria-hidden="true"
           style={direction === 'right' ? { transform: 'scaleX(-1)' } : undefined}>
        <path d="M8 1L1.5 7L8 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// A text shadow strong enough to keep bold white text legible over any
// photo, not just a dark one — belt and braces alongside the backdrop
// bar below, since a photo's own colors are unpredictable.
const LEGIBLE_TEXT_SHADOW = { textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.5)' };

/**
 * Exported so both the Overview page's "My Cards" preview and the
 * Statements page's account deck (`AccountFilter.jsx`) render the
 * same card face without duplicating the drawing logic. There used
 * to be a smaller `compact` variant with its own tuned offsets, built
 * for the deck when it was narrower — removed once the deck grew to
 * full size and nothing called it with `compact` anymore (there was
 * room to spare, and a shrunken card read worse than the real thing).
 */
// The color/brand gradient alone, no photo — shared by the front (when
// there's no uploaded image) and the back (which never shows the front
// photo, since a real card's back isn't a second copy of its face).
// Type on a drawn face: white on the usual dark gradient, near-black on a light product (Apple Card, Gold).
const LIGHT_INK = { base: 'text-white', soft: 'text-white/70', faint: 'text-white/55', number: 'text-white/95', mark: 'text-white/85' };
const DARK_INK = { base: 'text-black/85', soft: 'text-black/60', faint: 'text-black/45', number: 'text-black/80', mark: 'text-black/70' };

function gradientBackground(account, brand) {
  return brand
    ? { background: `linear-gradient(155deg, ${brand.primary} 0%, ${brand.secondary} 100%)` }
    : { background: `linear-gradient(155deg, ${account.color ?? '#5A5A6B'} 0%, color-mix(in srgb, ${account.color ?? '#5A5A6B'} 65%, black) 100%)` };
}

/** The card number as four groups spread across the face; the last four are the account's. */
function CardNumber({ groups, className = '', style }) {
  return (
    <div className={`absolute inset-x-6 flex justify-between font-mono font-bold tnum ${className}`} style={style}>
      {groups.map((g, i) => <span key={i} className={i < 3 ? 'tracking-[0.12em]' : 'tracking-[0.08em]'}>{g}</span>)}
    </div>
  );
}

export function CardFace({ account }) {
  const hasImage = Boolean(account.image_path);
  const credit = isCard(account);

  // A recognized bank's real color is a smarter DEFAULT than flat gray
  // for a checking/savings account — but only a default. The moment
  // this account has its own color or photo (the existing customize
  // picker), that always wins; this never overrides a choice you made.
  const brand = !credit && !hasImage && !account.color ? bankBrandFor(account.issuer) : null;
  // A known card product drawn in its own colours (D403), on the same terms: a photo or a colour you chose wins.
  const product = credit && !hasImage && !account.color ? cardProductFor(account) : null;
  const ink = product?.light ? DARK_INK : LIGHT_INK;

  const background = hasImage
    ? {
        backgroundImage: `url(/api/account-images/${account.image_path.split('/').pop()})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : product ? productBackground(product) : gradientBackground(account, brand);

  const numberGroups = account.mask
    ? ['••••', '••••', '••••', account.mask]
    : ['••••', '••••', '••••', '••••'];
  const holderName = maskName(account.holder_name || account.person_name);
  // Everyone on a shared card (D344), as initials on the card itself.
  const shared = sharedPeople(account, []);

  return (
    // Fixed height, not aspect-ratio + flex: the content zones are
    // pinned by absolute inset (in px, not %), which stays correct
    // regardless of how the parent's height gets computed — a flex
    // h-full + justify-between combination previously let the bottom
    // row drift into the rounded corner and get clipped.
    <div className={`relative h-56 w-full max-w-96 overflow-hidden rounded-2xl shadow-md ${hasImage ? 'text-white' : ink.base}`} style={background}>
      {hasImage ? (
        <>
          {/* A real, solid dark bar — not just a soft gradient — so
              bold text reads against ANY photo, not only a dark one. */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

          {shared && <div className="absolute right-5 top-5"><SharedMark people={shared} /></div>}

          <CardNumber groups={numberGroups} className="bottom-16 text-xl" style={LEGIBLE_TEXT_SHADOW} />

          <div className="absolute inset-x-6 bottom-5 text-base font-bold uppercase leading-tight tracking-wide line-clamp-2" style={LEGIBLE_TEXT_SHADOW}>
            {holderName}
          </div>
        </>
      ) : (
        <>
          {/* Clear of the flip hint in the top-right corner. */}
          <div className="absolute left-6 right-10 top-6 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-medium">{account.name}</div>
              {/* A recognized bank's mark, top right, already says which
                  bank this is -- repeating its name here would be the
                  same fact twice. Only accounts without a mark (an
                  issuer we don't recognize) still get the plain text. */}
              {account.issuer && !brand && <div className={`text-xs ${ink.soft}`}>{account.issuer}</div>}
            </div>
            <div className={`flex shrink-0 items-center gap-2 ${ink.mark}`}>
              {shared && <SharedMark people={shared} light={product?.light} />}
              {credit ? <ChipIcon /> : brand ? <BrandMark brandKey={brand.key} /> : <BankMark />}
              <ContactlessIcon />
            </div>
          </div>

          {/* The four groups spread across the card, as they're embossed on a real one. */}
          <CardNumber groups={numberGroups} className={`bottom-[4.75rem] text-xl ${ink.number}`} />

          <div className="absolute inset-x-6 bottom-5 flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              {/* The whole name: two lines before it would ever be cut. */}
              <div className="text-sm font-bold uppercase leading-tight tracking-wide line-clamp-2">
                {holderName}
              </div>
              <div className={`mt-0.5 truncate text-[10px] uppercase tracking-wider ${ink.faint}`}>
                {credit ? 'Credit card' : account.account_type === 'SAVINGS' ? 'Savings account' : 'Checking account'}
              </div>
            </div>
            {product && <div className="shrink-0"><NetworkMark network={product.network} light={product.light} /></div>}
          </div>
        </>
      )}
    </div>
  );
}

function FlipHint() {
  // A quiet corner affordance, not instructional text — the same
  // "discoverable, not explained" register as the rest of this app's
  // icon-only chips (RecurringChip, MerchantAvatar).
  return (
    <div className="absolute right-3 top-3 text-white/50">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 6a5.5 5.5 0 019.5-2.5M13.5 10a5.5 5.5 0 01-9.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M12 1.5v2.5h-2.5M4 14.5V12h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * The back: year-to-date spend on this account and its top 3
 * merchants, fetched lazily since it only ever mounts for the
 * centered card (see FlippableCard) — the two fan-deck neighbors
 * never render a back face at all, so they never fire this request.
 */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** One figure on the back: a small label over its value. */
function BackFigure({ label, title, children }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="truncate text-[10px] uppercase tracking-wider text-white/55">{label}</div>
      <div className="truncate font-mono text-[13px] text-white/95 tnum">{children}</div>
    </div>
  );
}

/**
 * The back of a credit card (D347): what its statement printed, for the
 * month picked on the calendar or the newest. How much of the limit was used
 * (the limit can change month to month), the limit and what was available,
 * the cash advance limit, the bill, and the year's fees and interest so far.
 * A statement that prints no limit uses the last one printed, dated, or says
 * why there's none (backLimit). `data` is GET …/statement-facts: undefined
 * while loading; its statement null when none closed that month.
 */
/**
 * The share used, counting up, and its bar filling, each time the back is
 * turned to or the month changes (`run` changes). Vivid and Glass only, as
 * their motion is; Classic and Reduce Motion show the figures as they are.
 */
function useUsedMeter({ pct, used, run, still }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (still) return undefined; // the figure is shown as it is, below
    const go = animate(0, pct, { duration: 0.8, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => go.stop();
  }, [pct, run, still]);
  const width = `${Math.min(Math.max(pct, used > 0 ? 1 : 0), 100)}%`;
  return {
    figure: <span className="font-mono text-2xl font-bold tnum">{still ? pct : shown}%</span>,
    bar: (
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/20" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Credit used">
        {still
          ? <div className="h-full rounded-full bg-white" style={{ width }} />
          : <motion.div key={run} className="h-full rounded-full bg-white" initial={{ width: 0 }} animate={{ width }} transition={{ type: 'spring', bounce: 0, duration: 0.8 }} />}
      </div>
    ),
  };
}

function CardFactsBack({ account, data, monthFilter, shown }) {
  const facts = data === undefined ? undefined : data?.statement ?? null;
  const { u, note, lastPrinted } = backLimit(data);
  const { design } = useDesign();
  const still = useReducedMotion() || design === 'classic';
  const meter = useUsedMeter({ pct: u?.pct ?? 0, used: u?.used ?? 0, run: `${facts?.id ?? 'none'}:${shown}`, still: still || !shown });
  const money = (c) => (c == null ? '—' : formatMoney(Number(c)));
  const year = facts?.ytd_year ?? facts?.period_end?.slice(0, 4);
  return (
    <div className="relative flex h-56 w-full max-w-96 flex-col overflow-hidden rounded-2xl p-5 text-white shadow-md" style={gradientBackground(account, null)}>
      <FlipHint />
      <div className="pr-6 text-xs uppercase tracking-wider text-white/60">
        {facts ? `${monthWords(facts.period_end.slice(0, 7))} statement · closed ${formatShortDate(facts.period_end)}` : monthFilter ? monthWords(monthFilter) : 'Statement'}
      </div>
      {facts === undefined ? (
        <Loading tone="text-white/70" />
      ) : facts === null ? (
        <p className="mt-2 text-sm text-white/75">No statement closed {monthFilter ? `in ${monthWords(monthFilter)}` : 'yet'}.</p>
      ) : (
        <>
          {/* The hero: how much of the limit it used, or what it owed when no limit is known. */}
          <div className="mt-1.5">
            {u ? (
              <>
                <div className="flex min-w-0 items-baseline gap-2">
                  {meter.figure}
                  <span className="truncate text-xs text-white/75">
                    {lastPrinted ? note : <>of the <span className="font-mono tnum">{money(u.limit)}</span> limit used</>}
                  </span>
                </div>
                {meter.bar}
              </>
            ) : (
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tnum">{money(facts.closing_balance_cents)}</span>
                <span className="truncate text-xs text-white/75">owed · {note}</span>
              </div>
            )}
          </div>
          {/* What the statement says it earned (D351), quietly, under the bar. */}
          {/* One quiet line under the bar: installment plans still being paid that month (D356), the
              more specific, else what the statement says was earned (D351), which then rides in its title. */}
          {(planLine(facts.plans, (c) => formatMoney(c)) ?? earnedLine(facts, (c) => formatMoney(c))) && (
            <p className="mt-2 truncate text-xs text-white/75 tnum" title={planLine(facts.plans, (c) => formatMoney(c)) ? earnedLine(facts, (c) => formatMoney(c)) ?? undefined : undefined}>
              {planLine(facts.plans, (c) => formatMoney(c)) ?? earnedLine(facts, (c) => formatMoney(c))}
            </p>
          )}
          {/* Six figures, one each: the bill, the room left, and the year's cost so far. */}
          <div className="mt-auto grid grid-cols-3 gap-x-3 gap-y-2">
            {u ? (
              <>
                <BackFigure label="Owed">{money(facts.closing_balance_cents)}</BackFigure>
                {/* Printed, or the rest of a limit not printed on this statement, said as an estimate (D357). */}
                <BackFigure label={facts.available_credit_cents == null && u.availableEstimated ? 'Available · est.' : 'Available'}>
                  {money(facts.available_credit_cents ?? (u.availableEstimated ? u.available : null))}
                </BackFigure>
              </>
            ) : (
              <>
                <BackFigure label="Opening">{money(facts.opening_balance_cents)}</BackFigure>
                <BackFigure label="Cash back">{money(facts.cashback_earned_cents)}</BackFigure>
              </>
            )}
            {/* Its purchase APR as printed (D349); the other rates in the title. */}
            <BackFigure label={facts.apr_variable ? 'APR · variable' : 'APR'} title={otherAprs(facts) || undefined}>{aprText(facts.apr_purchase_bps) ?? '—'}</BackFigure>
            <BackFigure label={facts.minimum_payment_cents != null ? `Due · min ${money(facts.minimum_payment_cents)}` : 'Due'}>
              {facts.payment_due_date ? formatShortDate(facts.payment_due_date) : '—'}
            </BackFigure>
            <BackFigure label={`Fees ${year}`}>{money(facts.ytd_fees_cents)}</BackFigure>
            <BackFigure label={`Interest ${year}`}>{money(facts.ytd_interest_cents)}</BackFigure>
          </div>
        </>
      )}
    </div>
  );
}

function CardBack({ account, facts, monthFilter, shown }) {
  // A credit card's back is its statement (D347); a bank account's, its balance and what it earned (D355).
  if (isCard(account)) return <CardFactsBack account={account} data={facts} monthFilter={monthFilter} shown={shown} />;
  return <BankBack account={account} data={facts} monthFilter={monthFilter} />;
}

/**
 * The back of a bank account (D355): its balance on the picked month's
 * statement (or the newest), the yield that statement printed, and the year
 * so far: interest, tax withheld, money in and out, and bonuses paid.
 * `data` is GET …/bank-facts, undefined while loading.
 */
function BankBack({ account, data, monthFilter }) {
  const brand = !account.color ? bankBrandFor(account.issuer) : null;
  const s = data?.statement ?? null;
  const ytd = data?.year_to_date ?? {};
  const sv = s?.savings ?? {};
  const money = (c) => (c == null ? '—' : formatMoney(Number(c)));
  const year = data?.year;
  return (
    <div className="relative flex h-56 w-full max-w-96 flex-col overflow-hidden rounded-2xl p-5 text-white shadow-md" style={gradientBackground(account, brand)}>
      <FlipHint />
      <div className="pr-6 text-xs uppercase tracking-wider text-white/60">
        {s ? `${monthWords(s.period_end.slice(0, 7))} statement · closed ${formatShortDate(s.period_end)}` : monthFilter ? monthWords(monthFilter) : 'Balance'}
      </div>
      {data === undefined ? (
        <Loading tone="text-white/70" />
      ) : !s ? (
        <p className="mt-2 text-sm text-white/75">No statement closed {monthFilter ? `in ${monthWords(monthFilter)}` : 'yet'}.</p>
      ) : (
        <>
          <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tnum">{money(s.closing_balance_cents)}</span>
            <span className="truncate text-xs text-white/75">{sv.apy_bps != null ? `in the account · earning ${aprText(sv.apy_bps)} APY` : 'in the account'}</span>
          </div>
          <div className="mt-auto grid grid-cols-3 gap-x-3 gap-y-2">
            <BackFigure label={`Interest ${monthWords(s.period_end.slice(0, 7)).slice(0, 3)}`}>{money(sv.interest_cents)}</BackFigure>
            <BackFigure label={`Interest ${year}`}>{money(sv.interest_ytd_cents ?? ytd.interest_cents)}</BackFigure>
            <BackFigure label={`Tax withheld ${year}`}>{money(sv.tax_withheld_ytd_cents)}</BackFigure>
            <BackFigure label={`In ${year}`}>{money(ytd.in_cents)}</BackFigure>
            <BackFigure label={`Out ${year}`}>{money(ytd.out_cents)}</BackFigure>
            <BackFigure label={ytd.bonus_count ? `Bonuses · ${ytd.bonus_count}` : 'Bonuses'}>{money(ytd.bonus_cents)}</BackFigure>
          </div>
        </>
      )}
    </div>
  );
}

/** The centered card only — wraps CardFace/CardBack in a real 3D flip,
 * click (or Enter/Space) to toggle. The fan-deck neighbors render a
 * plain CardFace directly; they're never flippable, so they never pay
 * for this wrapper or its lazy CardBack fetch. */
function FlippableCard({ account, flipped, onToggle, facts, monthFilter }) {
  return (
    <div style={{ perspective: '1600px' }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Show card front' : isCard(account) ? 'Show card back, its statement' : 'Show card back, spend summary'}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="relative h-56 w-full max-w-96 cursor-pointer"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.5s cubic-bezier(0.4, 0.1, 0.2, 1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <CardFace account={account} />
          <FlipHint />
        </div>
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <CardBack account={account} facts={facts} monthFilter={monthFilter} shown={flipped} />
        </div>
      </div>
    </div>
  );
}

function ColorSwatches({ account, onPicked }) {
  return (
    <div className="flex items-center gap-1.5">
      {PALETTE.map((hex) => (
        <button
          key={hex}
          onClick={() => onPicked(hex)}
          aria-label={`Set card color ${hex}`}
          className={`size-6 rounded-full transition-transform hover:scale-110 ${
            account.color === hex ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''
          }`}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}

// Fan-deck positions for the card either side of the selected one.
// translate-x is a single combined value per slot: -50% centers the
// card on its own anchor point (left-1/2), then the rest of the
// percentage is the fan offset — both expressed as % of the CARD'S
// OWN width, so they can't be split into two separate translate-x
// utility classes (Tailwind only keeps the last one of those; they
// don't add). Rotation and scale compose fine as their own classes.
const OFFSET_STYLE = {
  '-1': 'translate-x-[-88%] -translate-y-1/2 scale-[0.85] -rotate-6 opacity-80 z-20',
  '0':  'translate-x-[-50%] -translate-y-1/2 scale-100 rotate-0 opacity-100 z-30',
  '1':  'translate-x-[-12%] -translate-y-1/2 scale-[0.85] rotate-6 opacity-80 z-20',
};

export function CardCarousel({ accounts, selectedId, onSelect, onChanged, facts, monthFilter }) {
  const [customizing, setCustomizing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Which card is turned over, by id: moving to another card shows its
  // front without an effect having to flip it back (D211).
  const [flippedId, setFlippedId] = useState(null);
  const fileRef = useRef(null);

  const index = Math.max(0, accounts.findIndex((a) => a.id === selectedId));
  const selected = accounts[index] ?? accounts[0];

  // Always land back on the front when the centered card changes —
  // otherwise stepping from a flipped card to the next one would show
  // that next card's back with no flip of your own to explain it.
  const flipped = flippedId != null && flippedId === selected?.id;

  const step = (delta) => {
    const next = accounts[index + delta];
    if (next) onSelect(next.id);
  };

  const notify = useNotify();
  // A colour swatch shows on the card the moment it's picked, and gets tried
  // several times in a row, so only the photo changes confirm with a toast (D232).
  const pickColor = async (hex) => {
    if (!selected) return;
    setError(null);
    try {
      await api.accounts.setColor(selected.id, hex);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.accounts.uploadImage(selected.id, file);
      onChanged();
      notify(selected.name, { name: 'photo.added' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const removeImage = async () => {
    if (!selected) return;
    setError(null);
    try {
      await api.accounts.removeImage(selected.id);
      onChanged();
      notify(selected.name, { name: 'photo.removed' });
    } catch (err) {
      setError(err.message);
    }
  };

  if (accounts.length === 0 || !selected) return null;

  // Only the card either side of center ever needs to render — the
  // rest sit off-screen with nothing to show.
  const visible = accounts
    .map((a, i) => ({ account: a, diff: i - index }))
    .filter(({ diff }) => Math.abs(diff) <= 1);

  return (
    <div className="mb-6">
      {/* Phones: the whole row (arrows + a real-card-shaped 24rem card) is scaled
          down together with `zoom`, which also shrinks its layout width —
          squeezing the card's width instead would distort its proportions. */}
      <div className="flex items-center justify-center gap-4 max-sm:[zoom:0.66]">
        <ArrowButton direction="left" onClick={() => step(-1)} disabled={index === 0} />

        {/* `isolate`: the cards' z-index (front card z-30) only orders them among
            themselves — without it the front card painted over every page-level
            dialog (z-20) opened on the Cards page. */}
        <div className="relative isolate h-56 w-[27rem] max-w-full overflow-hidden">
          {visible.map(({ account, diff }) => (
            <div
              key={account.id}
              onClick={() => { if (diff !== 0) onSelect(account.id); }}
              className={`absolute left-1/2 top-1/2 w-96 transition-all duration-300 ease-out
                          ${diff !== 0 ? 'cursor-pointer' : ''} ${OFFSET_STYLE[diff]}`}
            >
              {diff === 0 ? (
                <FlippableCard account={account} flipped={flipped} facts={facts} monthFilter={monthFilter} onToggle={() => setFlippedId(flipped ? null : selected?.id)} />
              ) : (
                <CardFace account={account} />
              )}
            </div>
          ))}
        </div>

        <ArrowButton direction="right" onClick={() => step(1)} disabled={index === accounts.length - 1} />
      </div>

      {accounts.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {accounts.map((a, i) => (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              aria-label={`Show ${a.name}`}
              className={`size-1.5 rounded-full transition-colors ${i === index ? 'bg-ink' : 'bg-rule-str'}`}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          onClick={() => setCustomizing(!customizing)}
          className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {customizing ? 'Done' : 'Customize this card'}
        </button>
        {busy && <span className="text-sm text-faint">Uploading…</span>}
      </div>

      {customizing && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 rounded-lg border border-rule bg-raised p-3">
          <ColorSwatches account={selected} onPicked={pickColor} />
          <span className="text-faint">or</span>
          <button
            onClick={() => fileRef.current?.click()}
            className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Upload a photo of the card
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadImage} className="hidden" />
          {selected.image_path && (
            <button
              onClick={removeImage}
              className="text-sm text-faint underline-offset-4 hover:text-spend hover:underline"
            >
              Remove image
            </button>
          )}
          {!selected.image_path && selected.color && bankBrandFor(selected.issuer) && !isCard(selected) && (
            <button
              onClick={() => pickColor(null)}
              className="text-sm text-faint underline-offset-4 hover:text-ink hover:underline"
            >
              Reset to {bankBrandFor(selected.issuer).name} default
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-center text-sm text-spend">{error}</p>}
    </div>
  );
}
