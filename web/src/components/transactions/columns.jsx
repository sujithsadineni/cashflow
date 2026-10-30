import { formatMoney, formatShortDate, maskName, shortPersonName } from '../../api';
import { TXN_TYPE_CHOICES, blankChoice, categoryChoices } from '../../lib/categories/dropdown-choices';
import { Dropdown } from '../ui/Dropdown';
import { txnName } from '../../lib/transactions/txn-name';
import { EditableText } from '../ui/Form';
import { MerchantAvatar } from '../ui/MerchantAvatar';
import { linkedDisplay, rowMark } from '../../lib/transactions/payment-source';
import { MarkedAvatar } from '../ui/PaymentMark';
import { transferName } from '../../lib/transactions/transfer-link';
import { accountShort } from '../../lib/transactions/txn-name';
import { paidChoices, paidValue } from '../../lib/transactions/payment-methods';
import { TxnName } from './TxnName';

/**
 * The transaction columns every ledger table shares (D146) — the
 * Transactions page shows all of them, a card's own list on the Cards
 * page shows four. Defined once, so a fix to how a merchant or an
 * amount renders lands on both pages instead of one.
 *
 * `show` picks which columns, in this order. Handlers are the page's
 * own (each keeps its rows in its own state).
 */

// Type and Category cells: the quiet Dropdown, plain text until hovered (D229).
const typeOptions = [blankChoice('—'), ...TXN_TYPE_CHOICES];

export const ALL_TRANSACTION_COLUMNS = ['date', 'merchant', 'type', 'category', 'account', 'person', 'amount'];

export function transactionColumns({
  categories,
  onRename,
  onRecategorize,
  onRetype,
  onRepay,
  onOpenMerchant,
  show = ALL_TRANSACTION_COLUMNS,
  showDescription = true,
}) {
  const categoryOptions = [blankChoice('—'), ...categoryChoices(categories ?? [])];
  const cashbackShown = show.includes('cashback');
  const byKey = {
    date: {
      key: 'date',
      header: 'Date',
      headerClassName: 'w-16 md:w-20',
      className: 'font-mono tnum whitespace-nowrap text-ink',
      render: (t) => formatShortDate(t.posted_date),
    },
    merchant: {
      key: 'merchant',
      header: 'Merchant',
      className: 'text-ink',
      render: (t) => (
        <div className="flex items-center gap-2">
          <MarkedAvatar mark={rowMark(t)}>
            {linkedDisplay(t) ? (
              // A matched payment shows the other side's logo: the bank that
              // paid it on the card, the card it paid on the bank (D199); the
              // Zelle mark when a person paid it, the card-payment glyph for cash (D200).
              <MerchantAvatar merchant={linkedDisplay(t).logo} description={linkedDisplay(t).zelle ? 'Zelle' : t.description} txnType="payment" amountCents={t.amount_cents} clickable={false} />
            ) : (
            <MerchantAvatar
              merchant={t.merchant}
              description={t.description}
              txnType={t.txn_type}
              amountCents={t.amount_cents}
              categoryName={t.category_name}
              categoryIconKey={t.category_icon_key}
              onClick={() => t.merchant && onOpenMerchant?.(t.merchant)}
            />
            )}
          </MarkedAvatar>
          <div className="min-w-0 flex-1">
            {/* The payment's ✓ or ! is a badge on the logo (D391), not after the name. */}
            {linkedDisplay(t) ? (
              // Its statement's own line is in the row's ＋ panel and the tooltip.
              <span className="block truncate" title={t.description}>{linkedDisplay(t).name}</span>
            ) : t.payment_source || t.transfer_link ? (
              // A card payment, or a move between your own accounts with its other half found (D265): your name.
              <EditableText value={txnName(t)} display={<TxnName t={t} />} placeholder={t.description} onSave={(name) => onRename(t, name)} className="block w-full truncate" />
            ) : t.place ? (
              // Where it happened, after the name in the same type (D225): "Costco - Mapleton, GA" / "Costco - Online".
              <span className="flex min-w-0 items-baseline" title={t.place.title}>
                <EditableText value={txnName(t)} display={<TxnName t={t} />} placeholder={t.description} onSave={(name) => onRename(t, name)} className="block min-w-0 shrink truncate" />
                <span className="shrink-0 whitespace-pre"> - {t.place.label}</span>
              </span>
            ) : (
            <EditableText value={txnName(t)} display={<TxnName t={t} />} placeholder={t.description} onSave={(name) => onRename(t, name)} className="block w-full truncate" />
            )}
            {/* A second line only when it adds something: with no merchant
                yet, the raw description is already EditableText's placeholder. */}
            {/* A linked transfer says where the money came from or went, instead of its line (D265). */}
            {t.transfer_link && !linkedDisplay(t) && (
              <div className="mt-0.5 hidden truncate text-xs text-muted md:block" title={t.description}>
                {transferName(t.transfer_link)}
              </div>
            )}
            {showDescription && !linkedDisplay(t) && !t.transfer_link && t.merchant && txnName(t) === t.merchant && (
              <div className="mt-0.5 hidden truncate text-xs text-faint md:block" title={t.description}>
                {t.description}
              </div>
            )}
            {/* A phone hides the Category and Account columns (D232); they ride here instead. */}
            <div className="mt-0.5 truncate text-xs text-faint md:hidden">
              {[t.category_name ?? 'Uncategorised', show.includes('account') && accountShort(t).label].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      ),
    },
    // How it was paid (D359): what the statement says, or the person's pick; narrow, beside the name.
    paid: {
      key: 'paid',
      header: 'Paid',
      phone: false,
      headerClassName: 'w-28',
      render: (t) => (
        <Dropdown quiet value={paidValue(t.paid_with)} onChange={(v) => onRepay(t, v)} options={paidChoices(t.paid_with)} aria-label="Paid with"
          className={`max-w-full text-sm ${t.paid_with?.source === 'you' ? 'text-ink' : 'text-muted'}`} />
      ),
    },
    type: {
      key: 'type',
      header: 'Type',
      phone: false,
      headerClassName: 'w-32 2xl:w-40',
      render: (t) => (
        <Dropdown quiet value={t.txn_type ?? ''} onChange={(v) => onRetype(t, v)} options={typeOptions} aria-label="Type" className="max-w-full text-sm text-muted" />
      ),
    },
    category: {
      key: 'category',
      header: 'Category',
      phone: false,
      headerClassName: 'w-36 2xl:w-44',
      render: (t) => (
        <Dropdown quiet value={t.category_id ?? ''} onChange={(v) => onRecategorize(t, v)} options={categoryOptions} recentKey="category" aria-label="Category" className="max-w-full text-sm text-muted" />
      ),
    },
    account: {
      key: 'account',
      header: 'Account',
      phone: false,
      headerClassName: 'w-44 2xl:w-60',
      className: 'truncate text-muted',
      render: (t) => (
        // Its nickname where it has one (D353), the full name on hover.
        <span title={accountShort(t).full}>{accountShort(t).label}</span>
      ),
    },
    person: {
      key: 'person',
      header: 'Person',
      phone: false,
      headerClassName: 'w-24',
      className: 'truncate text-muted',
      // Nickname, else first name (D237); the full name on hover.
      render: (t) => <span title={maskName(t.person_name)}>{shortPersonName(t.person_name, t.person_nickname)}</span>,
    },
    amount: {
      key: 'amount',
      header: 'Amount',
      headerClassName: 'w-24 text-right md:w-28',
      className: 'text-right font-mono tnum whitespace-nowrap',
      render: (t) => (
        <>
          <span className={t.amount_cents < 0 ? 'text-spend' : t.amount_cents > 0 ? 'text-earn' : 'text-muted'}>{formatMoney(t.amount_cents, { showSign: true })}</span>
          {/* On a phone the Cash back column folds under the amount, as the category does under the name. */}
          {cashbackShown && t.cashback_cents != null && (
            <div className={`mt-0.5 text-xs md:hidden ${t.cashback_cents < 0 ? 'text-spend' : 'text-earn'}`}>{formatMoney(t.cashback_cents, { showSign: true })} back</div>
          )}
        </>
      ),
    },
    // A card with a flat cash back rate (D330): what each row earned, or took back on a refund.
    cashback: {
      key: 'cashback',
      header: 'Cash back',
      phone: false,
      headerClassName: 'w-20 text-right md:w-24',
      className: 'text-right font-mono tnum whitespace-nowrap',
      render: (t) => (t.cashback_cents == null ? <span className="text-faint">—</span> : (
        <span className={t.cashback_cents < 0 ? 'text-spend' : 'text-earn'}>{formatMoney(t.cashback_cents, { showSign: true })}</span>
      )),
    },
  };
  return show.map((key) => byKey[key]);
}
