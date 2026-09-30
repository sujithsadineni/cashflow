/**
 * A small fixed catalog of category icons — simple single-stroke
 * glyphs, drawn white-on-color the same way CardPaymentIcon and
 * InterestEarnedIcon already are (MerchantAvatar.jsx), so a category
 * badge and a transaction-type badge read as the same design
 * language rather than two icon systems.
 *
 * `iconFor(name)` is a best-effort name match, not a real
 * classifier — new/renamed categories fall back to `dot` rather than
 * guessing wrong. It only ever supplies the DEFAULT: once a category
 * has its own `icon_key` in the database (set via the picker in
 * Settings), that always wins.
 */

const s = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };

export const ICON_CATALOG = [
  'home', 'bolt', 'cart', 'fork', 'car', 'fuel', 'bag', 'heart', 'shield',
  'refresh', 'star', 'tag', 'swap', 'card', 'tray-down', 'percent', 'bank',
  'undo', 'piggy', 'plane', 'film', 'briefcase', 'trend-up', 'dot',
];

const PATHS = {
  home: <path d="M2.5 8L8 3l5.5 5M4 6.8V13h8V6.8" {...s} />,
  bolt: <path d="M8.5 2L4 9h3.5L7 14l5-7.5H8.5L9.5 2z" {...s} strokeLinejoin="round" />,
  cart: (
    <>
      <path d="M2 3h1.6L5 10.5h6.5L13 5H4.2" {...s} />
      <circle cx="6" cy="13" r="1" {...s} />
      <circle cx="11" cy="13" r="1" {...s} />
    </>
  ),
  fork: (
    <>
      <path d="M4.5 2v5.5M3 2v3.5a1.5 1.5 0 003 0V2M6 2v3.5a1.5 1.5 0 01-3 0" {...s} />
      <path d="M4.5 7.5V14" {...s} />
      <path d="M11.5 2c-1 0-1.8 1-1.8 3s.8 3 1.8 3v6" {...s} />
    </>
  ),
  car: (
    <>
      <path d="M2.5 10V8.2L3.8 5h8.4l1.3 3.2V10" {...s} />
      <path d="M2.5 10h11v1.5h-11z" {...s} />
      <circle cx="4.8" cy="11.5" r="1.2" {...s} />
      <circle cx="11.2" cy="11.5" r="1.2" {...s} />
    </>
  ),
  fuel: (
    <>
      <path d="M3 14V3.5a1 1 0 011-1h4a1 1 0 011 1V14" {...s} />
      <path d="M3 14h6" {...s} />
      <path d="M3 8h5" {...s} />
      <path d="M9 5.5l2 1.3v4.7a1 1 0 002 0V7.5L11.5 5.5" {...s} />
    </>
  ),
  bag: (
    <>
      <path d="M3.5 5h9l.7 9h-10.4z" {...s} />
      <path d="M5.5 5V4a2.5 2.5 0 015 0v1" {...s} />
    </>
  ),
  heart: <path d="M8 13.5S2.5 10 2.5 6.2A2.7 2.7 0 018 4.8a2.7 2.7 0 015.5 1.4c0 3.8-5.5 7.3-5.5 7.3z" {...s} />,
  shield: <path d="M8 2l5 1.8v4.3c0 3.3-2.2 5.4-5 6.2-2.8-.8-5-2.9-5-6.2V3.8z" {...s} strokeLinejoin="round" />,
  refresh: (
    <>
      <path d="M2.5 8a5.5 5.5 0 019.5-3.5M13.5 8a5.5 5.5 0 01-9.5 3.5" {...s} />
      <path d="M11 2.5v2.5h-2.5" {...s} />
      <path d="M5 13.5V11h2.5" {...s} />
    </>
  ),
  star: <path d="M8 2.5l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" {...s} strokeLinejoin="round" />,
  tag: (
    <>
      <path d="M2.5 2.5h5L13.5 8.5l-5.5 5.5L2.5 8V2.5z" {...s} strokeLinejoin="round" />
      <circle cx="5.5" cy="5.5" r="1" {...s} />
    </>
  ),
  swap: <path d="M2.5 5.5h9L9 3M13.5 10.5h-9L7 13" {...s} />,
  card: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" {...s} />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" {...s} />
      <path d="M4.5 10.2l1.3 1.3 2.7-2.7" {...s} />
    </>
  ),
  'tray-down': (
    <>
      <path d="M8 2v7.5M5 7l3 3 3-3" {...s} />
      <path d="M2.5 11v2a1 1 0 001 1h9a1 1 0 001-1v-2" {...s} />
    </>
  ),
  percent: (
    <>
      <circle cx="5" cy="5" r="1.6" {...s} />
      <circle cx="11" cy="11" r="1.6" {...s} />
      <path d="M11.5 4.5l-7 7" {...s} />
    </>
  ),
  bank: (
    <>
      <path d="M2 6l6-3.5L14 6" {...s} strokeLinejoin="round" />
      <path d="M3 6.5V13M6.3 6.5V13M9.7 6.5V13M13 6.5V13" {...s} />
      <path d="M2 13h12" {...s} />
    </>
  ),
  undo: <path d="M4 4.5H9a4 4 0 010 8H5.5M4 4.5l2.3-2.3M4 4.5l2.3 2.3" {...s} />,
  piggy: (
    <>
      <path d="M3 8.5a4.5 4.5 0 014.5-4h2.3L11 3l1.3 1.5H13v3h-1.2" {...s} strokeLinejoin="round" />
      <path d="M3 8.5v2.3c0 .7.5 1.2 1.2 1.2H5v1.5h2v-1.5h2V13.5h2V12h.2a1.6 1.6 0 001.6-1.6V8.7" {...s} strokeLinejoin="round" />
      <circle cx="10.2" cy="6.7" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  plane: <path d="M14 2L2 7.2l4.5 1.3L8 13l1.7-4.3L14 6.5V2zM6.8 8.5L2 7.2" {...s} strokeLinejoin="round" />,
  film: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.2" {...s} />
      <path d="M5 3v10M11 3v10M2 6.3h3M11 6.3h3M2 9.7h3M11 9.7h3" {...s} />
    </>
  ),
  briefcase: (
    <>
      <rect x="2" y="5" width="12" height="8" rx="1.2" {...s} />
      <path d="M5.5 5V3.8a1 1 0 011-1h3a1 1 0 011 1V5" {...s} />
      <path d="M2 8.5h12" {...s} />
    </>
  ),
  dot: <circle cx="8" cy="8" r="3" {...s} />,
  // An ascending line with an arrowhead — Investment's own mark, kept
  // visually distinct from piggy (Savings), which the old default-icon
  // pattern match (/saving/) would otherwise have handed Investment too.
  // Three ascending bars, not a line-with-arrowhead — Overview.jsx's
  // existing SavingsIcon already owns that exact shape (a real near-
  // collision caught while building this: an early draft of this icon
  // copied it path-for-path, which would have made Investment and
  // Savings read as the same glyph everywhere they sit side by side).
  'trend-up': (
    <>
      <path d="M3 13V9M7.5 13V6M12 13V3" {...s} />
    </>
  ),
};

export function CategoryGlyph({ iconKey, size = 16 }) {
  const key = PATHS[iconKey] ? iconKey : 'dot';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[key]}
    </svg>
  );
}

// Best-effort default so every category looks right with zero setup.
// Matched on substrings of the lowercased name; order matters (first
// match wins), most-specific patterns first.
const DEFAULT_RULES = [
  [/rent/, 'home'],
  [/utilit|ev charg/, 'bolt'],
  [/grocer|costco/, 'cart'],
  [/din(e|ing)/, 'fork'],
  [/transport/, 'car'],
  [/fuel|gas/, 'fuel'],
  [/shop/, 'bag'],
  [/health/, 'heart'],
  [/insurance/, 'shield'],
  [/subscription/, 'refresh'],
  [/annual fee/, 'star'],
  [/cashback/, 'tag'],
  [/transfer/, 'swap'],
  [/card payment/, 'card'],
  [/salary|cash deposit|deposit/, 'tray-down'],
  [/interest/, 'percent'],
  [/loan/, 'bank'],
  [/zelle/, 'swap'],
  [/refund/, 'undo'],
  [/invest/, 'trend-up'],
  [/saving/, 'piggy'],
  [/travel/, 'plane'],
  [/entertainment/, 'film'],
  [/consulting|fee/, 'briefcase'],
];

export function defaultIconFor(name) {
  const n = (name ?? '').toLowerCase();
  for (const [pattern, key] of DEFAULT_RULES) {
    if (pattern.test(n)) return key;
  }
  return 'dot';
}
