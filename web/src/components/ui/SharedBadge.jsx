import { maskName } from '../../api';
import { useDesign } from '../../hooks/use-design';
import { avatarColorFor } from '../../lib/transactions/merchant-logos';
import { twoInitials } from '../../lib/accounts/members';
import { PersonAvatar } from './PersonAvatar';

/**
 * A shared card's badge (D344): the word and everyone on the card, owner
 * first, their avatars overlapping. `people` comes from sharedPeople().
 * `onDark` is for a selected list row or a card face, where text is white.
 */
export function SharedBadge({ people, size = 18, onDark = false, label = true }) {
  const { design } = useDesign();
  if (!people) return null;
  // A family icon where the person picked one (Vivid, Glass); else two initials, not
  // PersonAvatar's one, since the people on a card can share a first letter.
  const face = (p) => ((design === 'vivid' || design === 'glass') && p.avatar
    ? <PersonAvatar person={p} size={size} />
    : (
      <span className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
        style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: avatarColorFor(p.name) }} aria-hidden="true">
        {twoInitials(maskName(p.name))}
      </span>
    ));
  const names = people.map((p) => maskName(p.name)).join(' and ');
  return (
    <span title={`Shared: ${names}`} className="inline-flex shrink-0 items-center gap-1.5">
      {label && <span className={`text-[12px] font-medium ${onDark ? 'text-white/90' : 'text-muted'}`}>Shared</span>}
      <span className="flex">
        {people.map((p, i) => (
          <span key={p.id ?? i} className={`rounded-full ${i > 0 ? '-ml-1.5' : ''} ${onDark ? 'ring-2 ring-white/70' : 'ring-2 ring-raised'}`}>
            {face(p)}
          </span>
        ))}
      </span>
      <span className="sr-only">Shared: {names}</span>
    </span>
  );
}
