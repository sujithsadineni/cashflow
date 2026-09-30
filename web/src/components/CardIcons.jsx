import { motion } from 'motion/react';

/**
 * The Overview card icons, animated with the `motion` library (D138).
 *
 * At rest each one draws exactly what the old static icon drew. On
 * hover, the card's own `whileHover="hover"` (SummaryCard) propagates
 * down to the `variants` here, so every part of an icon can move on its
 * own timing — an arrow that falls into a tray and comes back from the
 * top, a bank whose columns go up one at a time. That per-part
 * choreography is what plain CSS couldn't do well: the first pass
 * (D137) moved each whole icon 2–3px in 0.6s, which on a 16px icon read
 * as a flicker, not as movement.
 *
 * Every animation runs about a second and plays once per hover. Reduced
 * motion is honored app-wide by the MotionConfig in App.jsx.
 */

const svgProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, overflow: 'visible' };
const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
// Rotations and scales pivot on the shape itself, not the SVG's origin.
const selfCenter = { transformBox: 'fill-box', originX: 0.5, originY: 0.5 };
const selfBottom = { transformBox: 'fill-box', originX: 0.5, originY: 1 };

const back = { duration: 0.35, ease: 'easeOut' };

// Leaves through one edge, reappears from the opposite one, settles.
const passThrough = (dx, dy) => ({
  rest: { x: 0, y: 0, opacity: 1, transition: back },
  hover: {
    x: [0, dx, -dx, 0],
    y: [0, dy, -dy, 0],
    opacity: [1, 0, 0, 1],
    transition: { duration: 1.1, times: [0, 0.42, 0.43, 1], ease: 'easeInOut' },
  },
});

const draw = (delay = 0, duration = 0.8) => ({
  rest: { pathLength: 1, opacity: 1, transition: back },
  hover: {
    pathLength: [0, 1],
    opacity: [0.2, 1],
    transition: { duration, delay, ease: 'easeOut' },
  },
});

export function IncomeIcon() {
  return (
    <motion.svg {...svgProps}>
      <motion.g variants={passThrough(0, 6)}>
        <path d="M8 2.5v7" {...stroke} />
        <path d="M5 6.5L8 9.5l3-3" {...stroke} />
      </motion.g>
      <motion.path
        d="M2.5 12.5h11"
        {...stroke}
        style={selfCenter}
        variants={{
          rest: { scaleX: 1, transition: back },
          hover: { scaleX: [1, 1, 1.25, 0.95, 1], transition: { duration: 1.1, times: [0, 0.35, 0.45, 0.6, 1] } },
        }}
      />
    </motion.svg>
  );
}

export function SpentIcon() {
  return (
    <motion.svg {...svgProps}>
      <motion.g variants={passThrough(0, -6)}>
        <path d="M8 13.5v-7" {...stroke} />
        <path d="M11 9.5L8 6.5l-3 3" {...stroke} />
      </motion.g>
      <motion.path
        d="M2.5 3.5h11"
        {...stroke}
        style={selfCenter}
        variants={{
          rest: { scaleX: 1, transition: back },
          hover: { scaleX: [1, 1, 1.25, 0.95, 1], transition: { duration: 1.1, times: [0, 0.35, 0.45, 0.6, 1] } },
        }}
      />
    </motion.svg>
  );
}

export function LoansIcon() {
  return (
    <motion.svg {...svgProps}>
      <motion.path
        d="M2 6.5L8 2.5l6 4"
        {...stroke}
        variants={{
          rest: { y: 0, opacity: 1, transition: back },
          hover: { y: [-5, 0.8, 0], opacity: [0, 1, 1], transition: { duration: 0.7, delay: 0.45, ease: 'easeOut' } },
        }}
      />
      {['M3 6.5v6', 'M6.3 6.5v6', 'M9.7 6.5v6', 'M13 6.5v6'].map((d, i) => (
        <motion.path
          key={d}
          d={d}
          {...stroke}
          style={selfBottom}
          variants={{
            rest: { scaleY: 1, transition: back },
            hover: { scaleY: [0, 1.15, 1], transition: { duration: 0.5, delay: i * 0.1, ease: 'easeOut' } },
          }}
        />
      ))}
      <path d="M2 13.5h12" {...stroke} />
    </motion.svg>
  );
}

export function SavingsIcon() {
  return (
    <motion.svg {...svgProps}>
      <motion.path d="M2.5 12.5l3.2-4 2.6 2.4L13.5 4.5" {...stroke} variants={draw(0, 0.8)} />
      <motion.path
        d="M10 4.5h3.5V8"
        {...stroke}
        style={selfCenter}
        variants={{
          rest: { scale: 1, opacity: 1, transition: back },
          hover: { scale: [0, 1.5, 1], opacity: [0, 1, 1], transition: { duration: 0.5, delay: 0.7, ease: 'easeOut' } },
        }}
      />
    </motion.svg>
  );
}

export function CashbackIcon() {
  return (
    <motion.svg
      {...svgProps}
      style={selfCenter}
      variants={{
        rest: { rotate: 0, scale: 1, transition: back },
        hover: { rotate: 360, scale: [1, 1.2, 1], transition: { type: 'spring', stiffness: 140, damping: 11 } },
      }}
    >
      <path d="M12.5 8a4.5 4.5 0 10-1.3 3.2" {...stroke} />
      <path d="M13 5v3h-3" {...stroke} />
    </motion.svg>
  );
}

export function FeeIcon() {
  return (
    <motion.svg
      {...svgProps}
      style={selfCenter}
      variants={{
        rest: { rotate: 0, transition: back },
        hover: { rotate: [0, -16, 13, -9, 5, 0], transition: { duration: 0.9 } },
      }}
    >
      <path d="M4 2.5h8v11l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1v-11z" {...stroke} />
      <motion.path d="M6 6h4" {...stroke} variants={draw(0.3, 0.4)} />
      <motion.path d="M6 8.5h4" {...stroke} variants={draw(0.55, 0.4)} />
    </motion.svg>
  );
}

export function InvestmentIcon() {
  return (
    <motion.svg {...svgProps}>
      {['M4 13V9.5', 'M8 13V6', 'M12 13V2.5'].map((d, i) => (
        <motion.path
          key={d}
          d={d}
          {...stroke}
          style={selfBottom}
          variants={{
            rest: { scaleY: 1, transition: back },
            hover: { scaleY: [0, 1.25, 1], transition: { duration: 0.55, delay: i * 0.18, ease: 'easeOut' } },
          }}
        />
      ))}
    </motion.svg>
  );
}

export function TransferOutIcon() {
  return (
    <motion.svg {...svgProps}>
      <motion.circle
        cx="5.5"
        cy="9.5"
        r="3.5"
        {...stroke}
        style={selfCenter}
        variants={{
          rest: { scale: 1, transition: back },
          hover: { scale: [1, 0.75, 1.1, 1], transition: { duration: 1.1, times: [0, 0.3, 0.7, 1] } },
        }}
      />
      <motion.path d="M8.5 6.5L13.5 1.5M13.5 1.5h-4M13.5 1.5v4" {...stroke} variants={passThrough(5, -5)} />
    </motion.svg>
  );
}

export function PersonTransferIcon() {
  const meet = (dx, dy) => ({
    rest: { x: 0, y: 0, transition: back },
    hover: { x: [0, dx, 0], y: [0, dy, 0], transition: { duration: 1, ease: 'easeInOut' } },
  });
  return (
    <motion.svg {...svgProps}>
      <motion.circle cx="4" cy="5" r="2" {...stroke} variants={meet(2.5, 1.8)} />
      <motion.circle cx="12" cy="11" r="2" {...stroke} variants={meet(-2.5, -1.8)} />
      <motion.path
        d="M5.5 6.5L10.5 9.5"
        {...stroke}
        variants={{
          rest: { pathLength: 1, opacity: 1, transition: back },
          hover: { pathLength: [1, 0, 1], opacity: [1, 0, 1], transition: { duration: 1, ease: 'easeInOut' } },
        }}
      />
    </motion.svg>
  );
}
