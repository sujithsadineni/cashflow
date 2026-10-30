/**
 * What a drawn card face carries besides its words (D405): the payment
 * network's mark, drawn here as simple shapes in each design's own way (no
 * network artwork is shipped), the contactless symbol every card has, and a glyph that
 * says the card is shared. All decorative: the card's text says the facts.
 */
import { maskName } from '../../api';
import { useDesign } from '../../hooks/use-design';

// Each design draws the network its own way (D406): Classic in one tone (the card's own type
// colour, no new bright colour), Glass and Vivid in the networks' colours, Vivid larger; always
// straight on the card, never on a backdrop (D414). Simple shapes, no network artwork.

function Mastercard({ tone, scale }) {
  const w = 46 * scale;
  if (tone) {
    return (
      <svg width={w} height={28 * scale} viewBox="0 0 46 28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="16" cy="14" r="12" />
        <circle cx="30" cy="14" r="12" />
      </svg>
    );
  }
  return (
    <svg width={w} height={28 * scale} viewBox="0 0 46 28" aria-hidden="true">
      <defs><clipPath id="mc-left"><circle cx="16" cy="14" r="13" /></clipPath></defs>
      <circle cx="16" cy="14" r="13" fill="#EB001B" />
      <circle cx="30" cy="14" r="13" fill="#F79E1B" />
      <circle cx="30" cy="14" r="13" fill="#FF5F00" clipPath="url(#mc-left)" />
    </svg>
  );
}

function Visa({ tone, light, scale }) {
  return (
    <svg width={58 * scale} height={20 * scale} viewBox="0 0 58 20" aria-hidden="true">
      <text x="29" y="17.5" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontStyle="italic"
        fontSize="21" letterSpacing="-0.5" fill={tone ? 'currentColor' : light ? '#1434CB' : '#fff'}>VISA</text>
    </svg>
  );
}

// American Express's "blue box": the two words stacked in white on its blue.
function Amex({ tone, scale }) {
  const word = { textAnchor: 'middle', fontFamily: 'Arial Narrow, Arial, sans-serif', fontWeight: 900, fontSize: 8.6, letterSpacing: 0.2, fill: tone ? 'currentColor' : '#fff' };
  return (
    <svg width={44 * scale} height={30 * scale} viewBox="0 0 44 30" aria-hidden="true">
      {tone
        ? <rect x="1" y="1" width="42" height="28" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        : <rect x="0" y="0" width="44" height="30" rx="3" fill="#016FD0" />}
      <text x="22" y="13.6" {...word}>AMERICAN</text>
      <text x="22" y="23.2" {...word}>EXPRESS</text>
    </svg>
  );
}

function Discover({ tone, light, scale }) {
  const ink = tone ? 'currentColor' : light ? '#231F20' : '#fff';
  const word = { fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: 0.3, fill: ink };
  return (
    <svg width={74 * scale} height={20 * scale} viewBox="0 0 74 20" aria-hidden="true">
      <text x="0" y="15" {...word}>DISC</text>
      {tone
        ? <circle cx="41" cy="10.5" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        : <circle cx="41" cy="10.5" r="6.5" fill="#F48024" />}
      <text x="48" y="15" {...word}>VER</text>
    </svg>
  );
}

/** The network's mark for a product's `network` ("VISA", "Mastercard", "AMEX", "DISCOVER"), or null. */
export function NetworkMark({ network, light = false }) {
  const { design } = useDesign();
  const tone = design === 'classic';
  const scale = design === 'vivid' ? 1.15 : 1;
  const props = { tone, light, scale };
  const mark = { VISA: <Visa {...props} />, MASTERCARD: <Mastercard {...props} />, AMEX: <Amex {...props} />, DISCOVER: <Discover {...props} /> }[network?.toUpperCase()];
  // On the card itself in every design: no backdrop behind it (the owner's ask).
  return mark ? <span role="img" aria-label={network} className="inline-flex">{mark}</span> : null;
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
 * A shared card (D344), shown, not spelled out: two people on a solid badge in the design's
 * accent (its info colour), ringed in white, so it reads on any card face (a pale frosted one vanished on light
 * cards and photos, D408). Who's on it is its label, for a hover and for a screen reader.
 */
export function SharedMark({ people }) {
  if (!people) return null;
  const names = people.map((p) => maskName(p.name)).join(' and ');
  return (
    <span role="img" aria-label={`Shared: ${names}`} title={`Shared: ${names}`}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-info text-white shadow-md ring-2 ring-white/90">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="7.5" cy="6.5" r="2.8" stroke="currentColor" strokeWidth="1.7" />
        <path d="M2.5 16.5c0-2.8 2.2-4.8 5-4.8s5 2 5 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="13.5" cy="7.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14.2 11.8c2 .3 3.5 2 3.5 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
