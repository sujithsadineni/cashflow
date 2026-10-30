import { MerchantAvatar } from '../ui/MerchantAvatar';

/**
 * A recurring bill's logo: the merchant's own avatar, exactly as every other
 * page draws it (D367). It used to look the logo up by itself, so a logo set in
 * Settings → Merchants (an upload, a website) showed everywhere but here. Now
 * there is one source: the household's choice first, then the known logo, then
 * initials. A picture, not a link (a bill's row is the click target).
 * Callers' `glyph` is ignored: only archived bills from before D185 had one.
 */
export function RecurringIcon({ name, size = 24, className = '' }) {
  return (
    <span className={`block shrink-0 ${className}`}>
      <MerchantAvatar merchant={name} size={size} clickable={false} />
    </span>
  );
}
