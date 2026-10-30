/**
 * What a drawn card face carries besides its words (D405): the payment
 * network's mark, drawn here as simple shapes with a soft gloss (no network
 * artwork is shipped), the contactless symbol every card has, and a glyph that
 * says the card is shared. All decorative: the card's text says the facts.
 */
import { maskName } from '../../api';

// A soft highlight across the top of a mark, the way a printed foil catches light.
function Gloss({ id, w, h, r = 4 }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={w} height={h / 2} rx={r} fill={`url(#${id})`} />
    </>
  );
}

function Mastercard() {
  return (
    <svg width="46" height="28" viewBox="0 0 46 28" aria-hidden="true">
      <defs><clipPath id="mc-left"><circle cx="16" cy="14" r="13" /></clipPath></defs>
      <circle cx="16" cy="14" r="13" fill="#EB001B" />
      <circle cx="30" cy="14" r="13" fill="#F79E1B" />
      <circle cx="30" cy="14" r="13" fill="#FF5F00" clipPath="url(#mc-left)" />
      <Gloss id="mc-gloss" w={46} h={28} r={14} />
    </svg>
  );
}

// A wordmark's gloss is in its letters: a box behind them would show on a coloured card.
function GlossFill({ id, light }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={light ? '#3A3F8F' : '#FFFFFF'} />
        <stop offset="0.55" stopColor={light ? '#1A1F71' : '#F2F4F8'} />
        <stop offset="1" stopColor={light ? '#10144D' : '#C9CED8'} />
      </linearGradient>
    </defs>
  );
}

function Visa({ light }) {
  const id = light ? 'visa-fill-l' : 'visa-fill-d';
  return (
    <svg width="56" height="22" viewBox="0 0 56 22" aria-hidden="true">
      <GlossFill id={id} light={light} />
      <text x="28" y="18" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontStyle="italic"
        fontSize="20" letterSpacing="0.5" fill={`url(#${id})`}>VISA</text>
    </svg>
  );
}

function Amex() {
  return (
    <svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true">
      <rect x="0.5" y="0.5" width="45" height="29" rx="4" fill="#2E77BB" stroke="#ffffff55" />
      <text x="23" y="19.5" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="11.5" letterSpacing="0.6" fill="#fff">AMEX</text>
      <Gloss id="amex-gloss" w={46} h={30} />
    </svg>
  );
}

function Discover({ light }) {
  const id = light ? 'disc-fill-l' : 'disc-fill-d';
  const word = { fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: 0.3, fill: `url(#${id})` };
  return (
    <svg width="74" height="20" viewBox="0 0 74 20" aria-hidden="true">
      <GlossFill id={id} light={light} />
      <defs>
        <radialGradient id="disc-dot" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#FFB36B" />
          <stop offset="1" stopColor="#E86A10" />
        </radialGradient>
      </defs>
      <text x="0" y="15" {...word}>DISC</text>
      <circle cx="41" cy="10.5" r="6.5" fill="url(#disc-dot)" />
      <text x="48" y="15" {...word}>VER</text>
    </svg>
  );
}

/** The network's mark for a product's `network` ("VISA", "Mastercard", "AMEX", "DISCOVER"), or null. */
export function NetworkMark({ network, light = false }) {
  const mark = { VISA: <Visa light={light} />, MASTERCARD: <Mastercard />, AMEX: <Amex />, DISCOVER: <Discover light={light} /> }[network?.toUpperCase()];
  return mark ? <span role="img" aria-label={network}>{mark}</span> : null;
}

export function ContactlessIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 8a5 5 0 010 8" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M11 5a9 9 0 010 14" stroke="currentColor" strokeOpacity="0.65" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14 2a13 13 0 010 20" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A shared card (D344), shown, not spelled out: two people in a frosted circle.
 * Who's on it is in its label, for a hover and for a screen reader.
 */
export function SharedMark({ people, light = false }) {
  if (!people) return null;
  const names = people.map((p) => maskName(p.name)).join(' and ');
  return (
    <span role="img" aria-label={`Shared: ${names}`} title={`Shared: ${names}`}
      className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm ${light ? 'bg-black/10 text-black/70' : 'bg-white/20 text-white'}`}>
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="7.5" cy="6.5" r="2.8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 16.5c0-2.8 2.2-4.8 5-4.8s5 2 5 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="13.5" cy="7.5" r="2.3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M14.2 11.8c2 .3 3.5 2 3.5 4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
