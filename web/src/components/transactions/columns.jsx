import { formatMoney, formatShortDate, maskName, shortPersonName } from '../../api';
import { TXN_TYPE_CHOICES, blankChoice, categoryChoices } from '../../dropdown-choices';
import { Dropdown } from '../ui/Dropdown';
import { txnName } from '../../txn-name';
import { EditableText } from '../Form';
import { MerchantAvatar } from '../MerchantAvatar';
import { linkedDisplay } from '../../payment-source';
import { PaymentMark } from '../PaymentMark';

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
  onOpenMerchant,
  show = ALL_TRANSACTION_COLUMNS,
  showDescription = true,
}) {
  const categoryOptions = [blankChoice('—'), ...categoryChoices(categories ?? [])];
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
          <div className="min-w-0 flex-1">
            {linkedDisplay(t) ? (
              // Its statement's own line is in the row's ＋ panel and the tooltip.
              <span className="flex min-w-0 items-center gap-1.5" title={t.description}>
                <span className="truncate">{linkedDisplay(t).name}</span>
                <PaymentMark source={linkedDisplay(t).link} />
              </span>
            ) : t.payment_source ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <EditableText value={txnName(t)} placeholder={t.description} onSave={(name) => onRename(t, name)} className="block min-w-0 flex-1 truncate" />
                <PaymentMark source={t.payment_source} />
              </span>
            ) : t.place ? (
              // Where it happened, after the name in the same type (D225): "Costco - Mapleton, GA" / "Costco - Online".
              <span className="flex min-w-0 items-baseline" title={t.place.title}>
                <EditableText value={txnName(t)} placeholder={t.description} onSave={(name) => onRename(t, name)} className="block min-w-0 shrink truncate" />
                <span className="shrink-0 whitespace-pre"> - {t.place.label}</span>
              </span>
            ) : (
            <EditableText value={txnName(t)} placeholder={t.description} onSave={(name) => onRename(t, name)} className="block w-full truncate" />
            )}
            {/* A second line only when it adds something: with no merchant
                yet, the raw description is already EditableText's placeholder. */}
            {showDescription && !linkedDisplay(t) && t.merchant && txnName(t) === t.merchant && (
              <div className="mt-0.5 hidden truncate text-xs text-faint md:block" title={t.description}>
                {t.description}
              </div>
            )}
            {/* A phone hides the Category and Account columns (D232); they ride here instead. */}
            <div className="mt-0.5 truncate text-xs text-faint md:hidden">
              {[t.category_name ?? 'Uncategorised', show.includes('account') && t.account_name].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
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
        <span title={t.account_name}>
          {t.account_name}
          {t.account_mask && <span className="font-mono text-xs tnum"> ···{t.account_mask}</span>}
        </span>
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
        <span className={t.amount_cents < 0 ? 'text-spend' : 'text-earn'}>{formatMoney(t.amount_cents, { showSign: true })}</span>
      ),
    },
  };
  return show.map((key) => byKey[key]);
}
