import { motion } from 'motion/react';
import { useDesign } from '../../design-context';
import { avatarColorFor, initialsFor } from '../../merchant-logos';
import { FAMILY_AVATARS } from '../../avatars';

/**
 * A person's badge, everywhere a person is shown (D144). Their chosen
 * family icon in Vivid; otherwise — and always in Classic, which keeps
 * no emoji — the coloured initials the app has always drawn.
 */
export function PersonAvatar({ person, size = 40 }) {
  const { design } = useDesign();
  if (design === 'vivid' && person.avatar) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-band ring-2 ring-offset-2 ring-offset-raised"
        style={{ width: size, height: size, fontSize: size * 0.55, '--tw-ring-color': avatarColorFor(person.name) }}
        aria-hidden="true"
      >
        {person.avatar}
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.32, backgroundColor: avatarColorFor(person.name) }}
      aria-hidden="true"
    >
      {initialsFor(person.name)}
    </span>
  );
}

/** A grid of family icons; picking one saves it, "Initials" clears it. A real radio group for keyboards. */
export function AvatarPicker({ value, onPick }) {
  return (
    <div role="radiogroup" aria-label="Choose an avatar" className="flex flex-wrap gap-1.5">
      {FAMILY_AVATARS.map((emoji) => (
        <motion.button
          key={emoji}
          role="radio"
          aria-checked={value === emoji}
          onClick={() => onPick(emoji)}
          whileHover={{ scale: 1.2, rotate: -8 }}
          whileTap={{ scale: 0.9 }}
          className={`flex size-9 items-center justify-center rounded-xl text-xl leading-none ${
            value === emoji ? 'bg-vivid-green/15 ring-2 ring-vivid-green' : 'bg-band hover:bg-rule/60'
          }`}
        >
          {emoji}
        </motion.button>
      ))}
      <button
        role="radio"
        aria-checked={!value}
        onClick={() => onPick(null)}
        className={`h-9 rounded-xl px-3 text-xs ${!value ? 'bg-vivid-green/15 text-vivid-green ring-2 ring-vivid-green' : 'bg-band text-muted hover:text-ink'}`}
      >
        Initials
      </button>
    </div>
  );
}
