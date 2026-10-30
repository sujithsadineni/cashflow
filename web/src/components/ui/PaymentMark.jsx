const CHECK = <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const LOOK = {
  verified: { label: 'Verified payment', title: 'Verified: where this was paid from is confirmed', className: 'bg-earn text-white' },
  // Named by the card's own line, its bank statement not uploaded yet (D200).
  named: { label: 'Payment source named, not yet confirmed', title: 'The card names where this came from. Upload that bank statement to confirm it', className: 'border border-earn text-earn' },
  // The other half of a move between your own accounts was found (D265).
  transfer: { label: 'Verified transfer', title: 'Verified: the other half of this transfer is in another of your accounts', className: 'bg-earn text-white' },
  unverified: { label: 'Payment not verified yet', title: 'Not verified yet. Open the row to see why', className: 'bg-spend text-white' },
};

/**
 * ✓ for a card payment whose source is confirmed, an outlined ✓ for one the card names, ! for one not known yet (D199, D200); ✓ for a linked transfer (D265).
 * `badge`: on a list row's logo, bottom-right (D391), ringed in the row's colour so it reads apart from the logo.
 */
export function PaymentMark({ source, title, badge = false }) {
  if (!source) return null;
  const look = LOOK[source.status] ?? LOOK.unverified;
  return (
    <span
      role="img"
      aria-label={look.label}
      title={title ?? look.title}
      style={badge ? { boxShadow: '0 0 0 2px var(--mark-ring, var(--color-raised))' } : undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none ${
        badge ? 'absolute -right-1 -bottom-1 size-3.5 text-[0.6rem] [&_svg]:size-2' : 'size-4 text-[0.65rem]'
      } ${look.className} ${badge && source.status === 'named' ? 'bg-raised' : ''}`}
    >
      {source.status === 'unverified' ? '!' : CHECK}
    </span>
  );
}

/**
 * A list row's logo with its payment mark as a badge (D391). The mark used to
 * trail the name, so it moved with the name's length and sat in different
 * places on Transactions and Cards; on the logo it's in one spot on every row.
 */
export function MarkedAvatar({ mark, children }) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      {mark && <PaymentMark source={mark.source} title={mark.title} badge />}
    </span>
  );
}
