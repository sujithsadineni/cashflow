/**
 * One icon per loan type (car / home / credit_card / other), same
 * 16x16 stroke language as every other icon in the app (Layout.jsx's
 * nav, Overview.jsx's card icons). Shared between the Overview Loans
 * card (a small deduplicated row of these) and the loans list dialog
 * (one per loan card), so both places agree on what each type looks
 * like.
 */

const iconProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
const strokeProps = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function CarIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M2.2 11.3v-2.1a1 1 0 01.85-1l1.75-.3.9-1.9a1 1 0 01.9-.6h2.8c.4 0 .75.25.9.6l.9 1.9 1.75.3a1 1 0 01.85 1v2.1"
        {...strokeProps}
      />
      <path d="M2 11.3h12" {...strokeProps} />
      <circle cx="4.8" cy="11.6" r="1.1" {...strokeProps} />
      <circle cx="11.2" cy="11.6" r="1.1" {...strokeProps} />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 7.5L8 2.5l6 5" {...strokeProps} />
      <path d="M3.5 6.5V13a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V6.5" {...strokeProps} />
      <path d="M6.5 13.5V9.5h3v4" {...strokeProps} />
    </svg>
  );
}

export function CreditCardIcon() {
  return (
    <svg {...iconProps}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" {...strokeProps} />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" {...strokeProps} />
    </svg>
  );
}

export function BalanceTransferIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 6h9.5M9.5 3.5L12 6l-2.5 2.5" {...strokeProps} />
      <path d="M13.5 10h-9.5M6.5 7.5L4 10l2.5 2.5" {...strokeProps} />
    </svg>
  );
}

export function OtherLoanIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 6.5L8 2.5l6 4" {...strokeProps} />
      <path d="M3 6.5v6M6.3 6.5v6M9.7 6.5v6M13 6.5v6" {...strokeProps} />
      <path d="M2 13.5h12" {...strokeProps} />
    </svg>
  );
}

const ICONS = {
  car: CarIcon,
  home: HomeIcon,
  credit_card: CreditCardIcon,
  balance_transfer: BalanceTransferIcon,
  other: OtherLoanIcon,
};

export function loanTypeIcon(type) {
  const Icon = ICONS[type] ?? OtherLoanIcon;
  return <Icon />;
}

export const LOAN_TYPE_LABEL = {
  car: 'Car',
  home: 'Home',
  credit_card: 'Credit card',
  balance_transfer: 'Balance transfer',
  other: 'Other',
};
