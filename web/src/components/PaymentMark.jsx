const CHECK = <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const LOOK = {
  verified: { label: 'Verified payment', title: 'Verified: where this was paid from is confirmed', className: 'bg-earn text-white' },
  // Named by the card's own line, its bank statement not uploaded yet (D200).
  named: { label: 'Payment source named, not yet confirmed', title: 'The card names where this came from. Upload that bank statement to confirm it', className: 'border border-earn text-earn' },
  unverified: { label: 'Payment not verified yet', title: 'Not verified yet. Open the row to see why', className: 'bg-spend text-white' },
};

/** ✓ for a card payment whose source is confirmed, an outlined ✓ for one the card names, ! for one not known yet (D199, D200). */
export function PaymentMark({ source }) {
  if (!source) return null;
  const look = LOOK[source.status] ?? LOOK.unverified;
  return (
    <span
      role="img"
      aria-label={look.label}
      title={look.title}
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold leading-none ${look.className}`}
    >
      {source.status === 'unverified' ? '!' : CHECK}
    </span>
  );
}
