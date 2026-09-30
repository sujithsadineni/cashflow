import { formatMoney, formatShortDate, maskName, TXN_TYPE_OPTIONS } from '../../api';
import { EditableText } from '../Form';
import { MerchantAvatar } from '../MerchantAvatar';

/**
 * The transaction columns every ledger table shares (D146) — the
 * Transactions page shows all of them, a card's own list on the Cards
 * page shows four. Defined once, so a fix to how a merchant or an
 * amount renders lands on both pages instead of one.
 *
 * `show` picks which columns, in this order. Handlers are the page's
 * own (each keeps its rows in its own state).
 */

// Quiet select: reads as plain text until you hover or focus it.
const QUIET_SELECT =
  'w-full cursor-pointer appearance-none rounded-md border border-transparent bg-transparent py-1 pr-1 text-sm text-muted ' +
  'transition-colors hover:border-rule hover:bg-band hover:px-1.5 focus:border-earn focus:bg-band focus:px-1.5 focus:outline-none';

export const ALL_TRANSACTION_COLUMNS = ['date', 'merchant', 'type', 'category', 'account', 'person', 'amount'];

export function transactionColumns({
  categories,
  onRename,
  onRecategorize,
  onRetype,
  onOpenMerchant,
  show = ALL_TRANSACTION_COLUMNS,
  showDescription = true,
}) {
  const byKey = {
    date: {
      key: 'date',
      header: 'Date',
      headerClassName: 'w-20',
      className: 'font-mono tnum whitespace-nowrap text-ink',
      render: (t) => formatShortDate(t.posted_date),
    },
    merchant: {
      key: 'merchant',
      header: 'Merchant',
      className: 'text-ink',
      render: (t) => (
        <div className="flex items-center gap-2">
          <MerchantAvatar
            merchant={t.merchant}
            description={t.description}
            txnType={t.txn_type}
            amountCents={t.amount_cents}
            categoryName={t.category_name}
            categoryIconKey={t.category_icon_key}
            onClick={() => t.merchant && onOpenMerchant?.(t.merchant)}
          />
          <div className="min-w-0 flex-1">
            <EditableText value={t.merchant} placeholder={t.description} onSave={(name) => onRename(t, name)} className="block w-full truncate" />
            {/* A second line only when it adds something: with no merchant
                yet, the raw description is already EditableText's placeholder. */}
            {showDescription && t.merchant && (
              <div className="mt-0.5 truncate text-xs text-faint" title={t.description}>
                {t.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    type: {
      key: 'type',
      header: 'Type',
      headerClassName: 'w-32',
      render: (t) => (
        <select value={t.txn_type ?? ''} onChange={(e) => onRetype(t, e.target.value)} className={`max-w-32 ${QUIET_SELECT}`}>
          <option value="">—</option>
          {TXN_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ),
    },
    category: {
      key: 'category',
      header: 'Category',
      headerClassName: 'w-36',
      render: (t) => (
        <select value={t.category_id ?? ''} onChange={(e) => onRecategorize(t, e.target.value)} className={`max-w-36 ${QUIET_SELECT}`}>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      ),
    },
    account: {
      key: 'account',
      header: 'Account',
      headerClassName: 'w-44',
      className: 'truncate text-muted',
      render: (t) => (
        <span title={t.account_name}>
          {t.account_name}
          {t.account_mask && <span className="font-mono text-xs tnum"> ···{t.account_mask}</span>}
        </span>
      ),
    },
    person: {
      key: 'person',
      header: 'Person',
      headerClassName: 'w-28',
      className: 'truncate text-muted',
      render: (t) => maskName(t.person_name),
    },
    amount: {
      key: 'amount',
      header: 'Amount',
      headerClassName: 'w-28 text-right',
      className: 'text-right font-mono tnum whitespace-nowrap',
      render: (t) => (
        <span className={t.amount_cents < 0 ? 'text-spend' : 'text-earn'}>{formatMoney(t.amount_cents, { showSign: true })}</span>
      ),
    },
  };
  return show.map((key) => byKey[key]);
}
