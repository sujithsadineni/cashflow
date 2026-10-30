import { motion } from 'motion/react';
import { maskName } from '../../../api';
import { PersonAvatar } from '../../ui/PersonAvatar';
import { MiniCard } from '../apple/SplitList';
import { Tilt } from './motion-bits';

/**
 * A person in the People list (D302), a small Contact Poster: their avatar
 * large, their name, how many accounts and statements, and their cards in
 * a fan that spreads while the pointer is over it. Selected, it takes the
 * accent ring and stays lifted, as a split view's selection holds.
 */
export function PersonPoster({ person, accounts, statements, selected, onSelect, still }) {
  const cards = accounts.filter((a) => a.is_active !== false).slice(0, 5);
  return (
    <Tilt still={still} className="rounded-2xl">
      <button
        type="button"
        data-row-id={person.id}
        onClick={() => onSelect(person.id)}
        aria-current={selected ? 'true' : undefined}
        className={`group/poster relative block w-full overflow-hidden rounded-2xl border bg-raised p-4 text-left transition-[border-color,box-shadow] duration-200 ${
          selected ? 'border-info shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-info)_25%,transparent),0_10px_24px_-14px_var(--color-info)]' : 'border-rule hover:border-rule-str hover:shadow-[0_10px_24px_-16px_rgb(0_0_0/0.35)]'
        }`}
      >
        <div className="flex items-center gap-3">
          <PersonAvatar person={person} size={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">{maskName(person.name)}</p>
            {person.nickname && <p className="truncate text-[13px] text-muted">“{person.nickname}”</p>}
            <p className="mt-0.5 text-[13px] text-muted tnum">
              {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
              {statements != null && <> · {statements.toLocaleString()} statements</>}
            </p>
          </div>
        </div>
        {/* Their cards, fanned; the fan spreads on hover. */}
        {cards.length > 0 && (
          <div className="mt-3 flex h-7 items-end" aria-hidden="true">
            {cards.map((a, i) => (
              <motion.span
                key={a.id}
                className="-mr-5 block"
                style={{ zIndex: cards.length - i }}
                initial={false}
                animate={{ rotate: still ? 0 : (i - (cards.length - 1) / 2) * 3 }}
                whileHover={still ? undefined : { y: -4 }}
              >
                <span className={`block transition-transform duration-300 ${still ? '' : 'group-hover/poster:translate-x-[var(--spread)]'}`} style={{ '--spread': `${i * 9}px` }}>
                  <MiniCard account={a} />
                </span>
              </motion.span>
            ))}
          </div>
        )}
      </button>
    </Tilt>
  );
}
