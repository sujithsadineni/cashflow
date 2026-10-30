import { loanArt } from '../../../lib/loans/loan-art';
import { LoanTypeIcon } from '../../loans/LoanIcons';

/**
 * A loan with no card of its own, drawn as one (D299), after Apple Card: a
 * single matte surface with nothing on it but the lender's name, what kind of
 * loan it is, and its glyph pressed into the corner. The matte is a soft
 * sheen from the top left over a fine grain, edged with a hairline of light;
 * the glyph is debossed (a dark fill with a lit lower lip), not printed.
 * The colours come from lib/loans/loan-art.js. Like any card in the app, it
 * keeps its own colours in light and dark.
 *
 *   size 'lg'  the detail's card, with the wordmark and the kind
 *   size 'sm'  a list row's, the surface and the glyph only
 */

// Fine grain, as an SVG noise tile: what turns a gradient into a material.
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function LoanCard({ loan, size = 'lg', className = '' }) {
  const art = loanArt(loan);
  const lg = size === 'lg';
  return (
    <span
      className={`relative isolate flex shrink-0 overflow-hidden ${lg ? 'aspect-[1.586] w-28 rounded-[10px] sm:w-36' : 'h-6 w-9 rounded-[4px]'} ${className}`}
      style={{
        background: `linear-gradient(150deg, ${art.base} 0%, ${art.deep} 100%)`,
        boxShadow: lg
          ? '0 0 0 0.5px rgb(0 0 0 / 0.14), 0 6px 18px -6px rgb(0 0 0 / 0.35)'
          : '0 0 0 0.5px rgb(0 0 0 / 0.12), 0 1px 2px rgb(0 0 0 / 0.15)',
      }}
      aria-hidden="true"
    >
      {/* The sheen: light falling on a matte surface from the top left. */}
      <span className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 12% 0%, rgb(255 255 255 / 0.22), transparent 58%)' }} />
      <span className="absolute inset-0 opacity-[0.22] mix-blend-overlay" style={{ backgroundImage: GRAIN, backgroundSize: lg ? '120px' : '60px' }} />
      {/* A hairline of light round the edge, darker along the bottom. */}
      <span className="absolute inset-0 rounded-[inherit]" style={{ boxShadow: 'inset 0 0 0 0.5px rgb(255 255 255 / 0.16), inset 0 -1px 0 rgb(0 0 0 / 0.18)' }} />

      {lg && (
        <>
          <span className="absolute top-2 left-2.5 right-2.5 truncate text-[9px] leading-none font-semibold tracking-[0.16em] sm:top-2.5 sm:left-3 sm:text-[10px]"
            style={{ color: art.wordmarkColor, textShadow: '0 -0.5px 0 rgb(0 0 0 / 0.25)' }}>
            {art.wordmark}
          </span>
          <span className="absolute bottom-2 left-2.5 text-[7px] leading-none font-medium tracking-[0.2em] text-white/60 uppercase sm:bottom-2.5 sm:left-3 sm:text-[8px]">
            {art.kind}
          </span>
        </>
      )}
      {/* The glyph, pressed in: a shadowed fill with a lit lower lip. */}
      <span
        className={`absolute flex ${lg ? 'right-2 bottom-1.5 scale-[1.7] sm:right-3 sm:bottom-2 sm:scale-[2]' : 'right-0.5 bottom-0 scale-[0.6]'} origin-bottom-right`}
        style={{ color: 'rgb(0 0 0 / 0.32)', filter: 'drop-shadow(0 0.6px 0 rgb(255 255 255 / 0.28))' }}
      >
        <LoanTypeIcon type={loan.loan_type} />
      </span>
    </span>
  );
}
