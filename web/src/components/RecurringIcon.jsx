import { useState } from 'react';
import { lookupMerchantDomain } from '../merchant-logos';

/**
 * A recurring series' icon: a real merchant logo (same lookup
 * MerchantAvatar uses elsewhere) when the merchant is recognized,
 * the glyph the user picked otherwise. This is the requirement, not
 * a nice-to-have — "Disney+", "YouTube", "Wells Fargo" etc. get their
 * real mark; an unrecognized merchant (no reliable domain to guess)
 * falls back to the emoji chosen at confirm time, exactly like
 * MerchantAvatar falls back to a colored initial.
 */
export function RecurringIcon({ name, glyph, size = 24, className = '' }) {
  const domain = lookupMerchantDomain(name);
  const [failed, setFailed] = useState(false);

  if (domain && !failed) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`}
        alt=""
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-md object-cover ${className}`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.65) }}
      className={`flex shrink-0 items-center justify-center leading-none ${className}`}
    >
      {glyph}
    </span>
  );
}
