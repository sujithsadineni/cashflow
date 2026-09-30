import { useState } from 'react';
import { lookupMerchantDomain, avatarColorFor, initialsFor } from '../merchant-logos';
import { useMerchantIcon } from '../merchant-icons-context';
import { CategoryGlyph, defaultIconFor } from '../category-icons';

/** A card-payment glyph, not a bare "?" — `merchant` is deliberately
 * null for these rows (paying your own card bill isn't a purchase at
 * a merchant, see api/src/parse/categorize.js's own classification
 * rule), so there was never a name to look a logo up by. This is a
 * rendering rule keyed on `txnType`, not a data patch, so it applies
 * to every row already in the database and every one imported after
 * today with no further changes. */
function CardPaymentIcon({ size }) {
  return (
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 10.2l1.3 1.3 2.7-2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Same reasoning as CardPaymentIcon, for interest income — a savings
 * account paying interest isn't a merchant either. A percent glyph
 * (the same shape Welcome.jsx's cashback card already uses, for the
 * same "rate-based" concept), not the hand/coin reference image
 * verbatim — that composition is too detailed to read at avatar size,
 * so it's simplified here to the one symbol worth keeping. */
function InterestEarnedIcon({ size }) {
  return (
    <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="11" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A small card-shaped avatar (rounded rect, not a circle), used
 * everywhere a transaction row shows who or what it was with. In
 * priority order:
 *
 *   1. A `contact` with a photo — a real person's real picture
 *      (uploaded via the Contacts manager, reachable from the Zelle
 *      review page). Once a contact has a photo, it replaces the
 *      generic Zelle mark everywhere that row appears — confirmed
 *      directly, this is the whole point of having contacts.
 *   2. A `contact` with no photo — a colored initial from their
 *      nickname (preferred) or name, same deterministic color scheme
 *      as everything else here.
 *   3. No `contact`, but the row is Zelle-shaped (`description`
 *      matches, no `merchant`) — the plain Zelle mark. This is what
 *      an unreviewed Zelle row shows, since it has no contact yet.
 *   4. A real `merchant` with a custom *photo* (set from Settings →
 *      Merchant icons) — a real image the household deliberately
 *      chose, so nothing auto-detected should second-guess it.
 *   5. A real `merchant` with a confident domain match — its real
 *      logo, fetched live. No image request is even attempted for an
 *      unmapped merchant: there's nothing to guess at, and a
 *      broken-image flicker looks worse than never trying. This
 *      ranks above a custom *emoji* on purpose: an emoji is a
 *      stand-in for "we don't have a real logo," not a deliberate
 *      choice over one — once a real logo is found (the domain map
 *      grows over time), it should replace the emoji automatically,
 *      with no manual cleanup needed.
 *   6. A real `merchant` with a custom emoji, but no domain match (or
 *      one whose fetch just failed — an ad blocker, say) — the emoji
 *      becomes the fallback picture instead of a bare initial.
 *   7. No icon of its own (no logo, no custom emoji — including rows
 *      with no `merchant` at all, like a "Cashback"/"Referral Bonus"/
 *      "Check Deposit" row that's a bank event, not a purchase) but a
 *      known `category` — that category's own glyph (set in Settings,
 *      or a sensible default guessed from its name). Wrong is a
 *      two-click fix via recategorizing the row, so a category glyph
 *      is a more useful fallback than a bare "?" or initial.
 *   8. A colored initial (or "?" with nothing to take an initial from),
 *      the fallback for everything else.
 *
 * Clickable only for a real merchant by default (opens its spend
 * history) — a contact avatar elsewhere in the app is a picture, not
 * a link; seeing a person's full history stays a Zelle-review-page
 * feature (`ZelleReview.jsx`'s own click-to-detail, which opts in via
 * the `clickable` prop), not wired to every surface that shows their
 * face.
 */
export function MerchantAvatar({ merchant, description, contact, txnType, amountCents, categoryName, categoryIconKey, onClick, size = 26, clickable = Boolean(merchant) }) {
  const isZelle = !merchant && /zelle/i.test(description ?? '');
  const isCardPayment = !merchant && !contact && !isZelle && txnType === 'payment';
  // Charged interest (a credit card cost) keeps the plain fallback —
  // only earned interest (real income, amount_cents > 0) gets this,
  // matching exactly what was asked for rather than the whole
  // txn_type='interest' bucket.
  const isInterestEarned = !merchant && !contact && !isZelle && !isCardPayment && txnType === 'interest' && amountCents > 0;
  const customIcon = useMerchantIcon(contact ? null : merchant);
  const domain = isZelle && !contact ? 'zellepay.com' : lookupMerchantDomain(merchant);
  const [imageFailed, setImageFailed] = useState(false);

  const contactLabel = contact ? (contact.nickname || contact.name) : null;
  const hasContactPhoto = Boolean(contact?.image_path) && !imageFailed;
  const hasCustomPhoto = !contact && Boolean(customIcon?.image_path) && !imageFailed;
  const showMerchantImage = !contact && !hasCustomPhoto && domain && !imageFailed;
  const hasCustomEmoji = !contact && !hasCustomPhoto && !showMerchantImage && Boolean(customIcon?.emoji);
  const hasCategoryFallback =
    !contact && !hasCustomPhoto && !showMerchantImage && !hasCustomEmoji &&
    !isCardPayment && !isInterestEarned && Boolean(categoryName);
  const categoryIcon = categoryIconKey ?? (categoryName ? defaultIconFor(categoryName) : null);

  const style = { width: size, height: size };
  const title = merchant
    ? `See spend history for ${merchant}`
    : contactLabel ?? (isZelle ? 'Zelle' : isCardPayment ? 'Card payment' : isInterestEarned ? 'Interest earned' : categoryName ?? undefined);

  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      title={title}
      className="shrink-0 overflow-hidden rounded-lg transition-transform enabled:hover:scale-110 disabled:cursor-default"
      style={style}
    >
      {hasContactPhoto ? (
        <img
          src={`/api/contact-images/${contact.image_path.split('/').pop()}`}
          alt=""
          className="size-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : contact ? (
        <span
          className="flex size-full items-center justify-center font-medium text-white"
          style={{ backgroundColor: avatarColorFor(contactLabel), fontSize: size * 0.4 }}
        >
          {initialsFor(contactLabel)}
        </span>
      ) : hasCustomPhoto ? (
        <img
          src={`/api/merchant-icons-static/${customIcon.image_path.split('/').pop()}`}
          alt=""
          className="size-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : showMerchantImage ? (
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`}
          alt=""
          className="size-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : hasCustomEmoji ? (
        <span
          className="flex size-full items-center justify-center bg-band"
          style={{ fontSize: size * 0.55 }}
        >
          {customIcon.emoji}
        </span>
      ) : isCardPayment ? (
        <span className="flex size-full items-center justify-center bg-earn text-white">
          <CardPaymentIcon size={size} />
        </span>
      ) : isInterestEarned ? (
        <span className="flex size-full items-center justify-center bg-earn text-white">
          <InterestEarnedIcon size={size} />
        </span>
      ) : hasCategoryFallback ? (
        <span
          className="flex size-full items-center justify-center text-white"
          style={{ backgroundColor: avatarColorFor(categoryName) }}
        >
          <CategoryGlyph iconKey={categoryIcon} size={size * 0.55} />
        </span>
      ) : (
        <span
          className="flex size-full items-center justify-center font-medium text-white"
          style={{ backgroundColor: avatarColorFor(merchant), fontSize: size * 0.4 }}
        >
          {initialsFor(merchant)}
        </span>
      )}
    </button>
  );
}
