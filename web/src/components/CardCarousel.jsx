import { useEffect, useRef, useState } from 'react';
import { api, formatMoney, maskName } from '../api';
import { bankBrandFor } from '../bankBrands';
import { MerchantAvatar } from './MerchantAvatar';
import bofaLogo from '../assets/bank-logos/bofa.png';
import chaseLogo from '../assets/bank-logos/chase.png';
import sofiLogo from '../assets/bank-logos/sofi.png';

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

function ContactlessIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 8a5 5 0 010 8" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11 5a9 9 0 010 14" stroke="currentColor" strokeOpacity="0.65" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 2a13 13 0 010 20" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
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
function gradientBackground(account, brand) {
  return brand
    ? { background: `linear-gradient(155deg, ${brand.primary} 0%, ${brand.secondary} 100%)` }
    : { background: `linear-gradient(155deg, ${account.color ?? '#5A5A6B'} 0%, color-mix(in srgb, ${account.color ?? '#5A5A6B'} 65%, black) 100%)` };
}

export function CardFace({ account }) {
  const hasImage = Boolean(account.image_path);
  const credit = isCard(account);

  // A recognized bank's real color is a smarter DEFAULT than flat gray
  // for a checking/savings account — but only a default. The moment
  // this account has its own color or photo (the existing customize
  // picker), that always wins; this never overrides a choice you made.
  const brand = !credit && !hasImage && !account.color ? bankBrandFor(account.issuer) : null;

  const background = hasImage
    ? {
        backgroundImage: `url(/api/account-images/${account.image_path.split('/').pop()})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : gradientBackground(account, brand);

  const numberGroups = account.mask
    ? ['••••', '••••', '••••', account.mask]
    : ['••••', '••••', '••••', '••••'];
  const holderName = maskName(account.holder_name || account.person_name);

  return (
    // Fixed height, not aspect-ratio + flex: the content zones are
    // pinned by absolute inset (in px, not %), which stays correct
    // regardless of how the parent's height gets computed — a flex
    // h-full + justify-between combination previously let the bottom
    // row drift into the rounded corner and get clipped.
    <div className="relative h-56 w-full max-w-96 overflow-hidden rounded-2xl text-white shadow-md" style={background}>
      {hasImage ? (
        <>
          {/* A real, solid dark bar — not just a soft gradient — so
              bold text reads against ANY photo, not only a dark one. */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/85 via-black/55 to-transparent" />

          <div className="absolute inset-x-6 bottom-16 font-mono text-xl font-bold tracking-[0.15em] tnum" style={LEGIBLE_TEXT_SHADOW}>
            {numberGroups.join('  ')}
          </div>

          <div className="absolute inset-x-6 bottom-6">
            <div className="truncate text-base font-bold uppercase tracking-wide" style={LEGIBLE_TEXT_SHADOW}>
              {holderName}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="absolute inset-x-6 top-6 flex items-start justify-between">
            <div className="min-w-0">
              <div className="truncate text-base font-medium">{account.name}</div>
              {/* A recognized bank's mark, top right, already says which
                  bank this is -- repeating its name here would be the
                  same fact twice. Only accounts without a mark (an
                  issuer we don't recognize) still get the plain text. */}
              {account.issuer && !brand && <div className="text-xs text-white/70">{account.issuer}</div>}
            </div>
            <div>
              {credit ? <ChipIcon /> : brand ? <BrandMark brandKey={brand.key} /> : <BankMark />}
            </div>
          </div>

          <div className="absolute inset-x-6 bottom-20 font-mono text-lg font-bold tracking-[0.15em] text-white/95 tnum">
            {numberGroups.join('  ')}
          </div>

          <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold uppercase tracking-wide">
                {holderName}
              </div>
              <div className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-white/55">
                {credit ? 'Credit card' : account.account_type === 'SAVINGS' ? 'Savings account' : 'Checking account'}
              </div>
            </div>
            <div className="shrink-0 text-white/85">{credit && <ContactlessIcon />}</div>
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
function CardBack({ account }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    api.accounts.summary(account.id)
      .then((d) => { if (!cancelled) setSummary(d); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [account.id]);

  const credit = isCard(account);
  const brand = !credit && !account.color ? bankBrandFor(account.issuer) : null;
  const year = new Date().getFullYear();

  return (
    <div
      className="relative h-56 w-full max-w-96 overflow-hidden rounded-2xl p-5 text-white shadow-md"
      style={gradientBackground(account, brand)}
    >
      <FlipHint />
      <div className="text-xs uppercase tracking-wider text-white/60">{year} year to date</div>

      {error ? (
        <p className="mt-2 text-sm text-white/70">{error}</p>
      ) : summary === null ? (
        <p className="mt-2 text-sm text-white/70">Loading…</p>
      ) : (
        <>
          <div className="mt-1 font-mono text-3xl font-bold tnum">{formatMoney(summary.ytd_spend_cents)}</div>

          {summary.top_merchants.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-white/60">Top merchants</div>
              <div className="mt-2 space-y-1.5">
                {summary.top_merchants.map((m) => (
                  <div key={m.merchant} className="flex items-center gap-2">
                    <MerchantAvatar merchant={m.merchant} size={24} clickable={false} />
                    <span className="min-w-0 flex-1 truncate text-sm text-white/90">{m.merchant}</span>
                    <span className="shrink-0 font-mono text-sm tnum text-white/80">{formatMoney(m.total_cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The centered card only — wraps CardFace/CardBack in a real 3D flip,
 * click (or Enter/Space) to toggle. The fan-deck neighbors render a
 * plain CardFace directly; they're never flippable, so they never pay
 * for this wrapper or its lazy CardBack fetch. */
function FlippableCard({ account, flipped, onToggle }) {
  return (
    <div style={{ perspective: '1600px' }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Show card front' : 'Show card back, spend summary'}
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
          <CardBack account={account} />
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

export function CardCarousel({ accounts, selectedId, onSelect, onChanged }) {
  const [customizing, setCustomizing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const fileRef = useRef(null);

  const index = Math.max(0, accounts.findIndex((a) => a.id === selectedId));
  const selected = accounts[index] ?? accounts[0];

  // Always land back on the front when the centered card changes —
  // otherwise stepping from a flipped card to the next one would show
  // that next card's back with no flip of your own to explain it.
  useEffect(() => setFlipped(false), [selected?.id]);

  const step = (delta) => {
    const next = accounts[index + delta];
    if (next) onSelect(next.id);
  };

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
      <div className="flex items-center justify-center gap-4">
        <ArrowButton direction="left" onClick={() => step(-1)} disabled={index === 0} />

        <div className="relative h-56 w-[27rem] max-w-full overflow-hidden">
          {visible.map(({ account, diff }) => (
            <div
              key={account.id}
              onClick={() => { if (diff !== 0) onSelect(account.id); }}
              className={`absolute left-1/2 top-1/2 w-96 transition-all duration-300 ease-out
                          ${diff !== 0 ? 'cursor-pointer' : ''} ${OFFSET_STYLE[diff]}`}
            >
              {diff === 0 ? (
                <FlippableCard account={account} flipped={flipped} onToggle={() => setFlipped((f) => !f)} />
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
