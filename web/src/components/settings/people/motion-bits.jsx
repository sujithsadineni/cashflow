import { useEffect, useState } from 'react';
import { animate, motion, useSpring } from 'motion/react';
import { formatMoney } from '../../../api';

/**
 * The People page's motion (D302), in every design: the owner asked for it,
 * the third Classic exception after the statement reveal (D171) and the
 * Recurring rings (D184). Springs only, critically damped (no bounce on
 * anything that wasn't thrown), and all of it off with Reduce Motion
 * (`still`): the same content, just without the movement.
 */

/** A card that leans toward the pointer and lifts while it's over it, like a Wallet card. */
export function Tilt({ still, max = 5, className = '', children, ...rest }) {
  const rx = useSpring(0, { stiffness: 260, damping: 28 });
  const ry = useSpring(0, { stiffness: 260, damping: 28 });
  if (still) return <div className={className} {...rest}>{children}</div>;
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * max * 2);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * max * 2);
  };
  const reset = () => { rx.set(0); ry.set(0); };
  return (
    <motion.div
      onPointerMove={move}
      onPointerLeave={reset}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** An amount that counts up to itself when it first shows, through formatMoney (so privacy mode masks every frame). */
export function CountUp({ cents, still, className = '' }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (still) return undefined;
    const run = animate(0, cents, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(Math.round(v)) });
    return () => run.stop();
  }, [cents, still]);
  return <span className={`tnum ${className}`}>{formatMoney(still ? cents : shown)}</span>;
}

/** A group arriving: a short rise and fade, each a beat after the one before. */
export function Rise({ still, index = 0, className = '', children }) {
  if (still) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.45, delay: 0.05 * index }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A bar that grows to its share. */
export function GrowBar({ share, still, className = '' }) {
  const width = `${Math.max(2, Math.min(100, share * 100))}%`;
  if (still) return <span className={className} style={{ width }} />;
  return <motion.span className={className} initial={{ width: 0 }} animate={{ width }} transition={{ type: 'spring', bounce: 0, duration: 0.7 }} />;
}
