/**
 * The issuer's own picture of a known card (D407), offered beside the drawn face: a
 * thumbnail button that either applies it (Customize this card) or marks it to apply once
 * the card is made (a new card's form). Never applied without being picked.
 */
const cardArtUrl = (art) => `${import.meta.env.BASE_URL}card-art/${art}`;

export function CardArtPick({ product, picked = false, onPick, label = 'Use its picture' }) {
  if (!product?.art) return null;
  return (
    <button type="button" onClick={onPick} aria-pressed={picked}
      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors ${picked ? 'border-ink text-ink' : 'border-rule text-muted hover:text-ink'}`}>
      <img src={cardArtUrl(product.art)} alt="" className="h-7 w-11 rounded object-cover" draggable={false} />
      <span>{picked ? 'Its picture, picked' : label}</span>
    </button>
  );
}
