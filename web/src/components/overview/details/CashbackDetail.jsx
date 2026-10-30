import { useState } from 'react';
import { api, formatMoney, formatShortDate } from '../../../api';
import { useApi } from '../../../hooks/use-api';
import { DetailDialog } from '../../ui/DetailDialog';
import { MerchantAvatar } from '../../ui/MerchantAvatar';
import { YearSwitch, MonthBars, Comparison, Explorer, CardThumb } from './MoneyExplorer';
import { MONTHS, NO_FILTER, signed } from '../../../lib/overview/explorer';
import { giftCardSub } from '../../../lib/overview/gift-card-form';
import { Button } from '../../ui/Form';
import { GiftCardForm } from './GiftCardForm';
import { Loading } from '../../ui/Loading';

/**
 * Cashback & Interest, in full (D283, D284). Money back is counted when it's
 * received, once (api/src/money/cashback.js); a card's printed rewards
 * balance is shown beside it as "waiting", never added in.
 *
 * The month bars, tiles and grid are the shared year explorer
 * (MoneyExplorer.jsx); what's cashback's own is here: its kinds, what each
 * card is still holding, a payout shown as the card it came from, and
 * Apple's Daily Cash, which is read off a statement and opens nothing, and a
 * flat-rate card's cash back (D330), worked out per statement, which opens nothing either.
 *
 * Built on the DetailDialog shell like the other drill-downs. It's one
 * section, so Vivid shows no tabs: a month picked in the chart has to stay
 * in view of the grid it filters.
 */

const KINDS = [
  { key: 'rewards', label: 'Rewards paid out' },
  { key: 'offer', label: 'Offers & credits' },
  { key: 'bonus', label: 'Bank bonuses' },
  { key: 'interest', label: 'Interest earned' },
  { key: 'giftcard', label: 'Gift cards' },
  { key: 'clawback', label: 'Daily Cash taken back' },
];

export function CashbackDetail({ month, onClose }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [filter, setFilter] = useState(NO_FILTER);
  // The gift card form, in place: null closed, 'new', or the gift card item being changed (D330).
  const [gift, setGift] = useState(null);
  const { data } = useApi(`cashback:${year}`, () => api.cashback(year), { tags: ['transactions', 'redemptions'] });

  const years = data?.years?.length ? data.years : [year];
  const pickYear = (y) => { setYear(y); setFilter(NO_FILTER); };
  const toggle = (key, value) => setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));

  return (
    <DetailDialog
      title="Cashback & Interest"
      emoji="🎁"
      tint="bg-vivid-green/10"
      actions={(
        <>
          {!gift && <Button variant="quiet" size="sm" onClick={() => setGift('new')}>Record a gift card</Button>}
          {years.length > 1 && <YearSwitch years={years} year={year} onChange={pickYear} />}
        </>
      )}
      hero={data && { label: data.through_month < 12 ? `${year} so far` : `Received in ${year}`, value: signed(data.total_cents), tone: 'earn' }}
      side={data?.waiting_cents > 0 && { label: 'Still waiting on cards', value: formatMoney(data.waiting_cents), tone: 'ink' }}
      sections={[
        {
          key: 'explore',
          label: 'Month by month',
          content: data ? (
            <>
              {gift && <GiftCardForm key={gift === 'new' ? 'new' : gift.id} gift={gift === 'new' ? null : gift} onDone={() => setGift(null)} />}
              <MonthBars months={data.months} through={data.through_month} kinds={KINDS} picked={filter.month} onPick={(m) => toggle('month', m)} empty="Nothing came back this year." />
              <Comparison data={data} verb="had brought back" />
              <Explorer
                data={data}
                kinds={KINDS}
                filter={filter}
                toggle={toggle}
                clear={() => setFilter(NO_FILTER)}
                onClose={onClose}
                noun={['credit', 'credits']}
                grouped={{ interest: 'Interest' }}
                accountExtra={waiting}
                describe={(item, card) => describe(item, card, setGift)}
              />
            </>
          ) : <Loading />,
        },
      ]}
      note="Counted when the money reaches you: a card's rewards when they're paid out, Apple's Daily Cash as it's earned (it goes straight to Apple Cash), a flat-rate card's cash back when its statement closes, worked out from its purchases and refunds, offers and bonuses when they post, gift cards you took rewards as on the day you got them, and interest your accounts earn. A balance a card is still holding is shown as waiting, read off its newest statement less anything paid out after the day it was printed for, and isn't added in until it's paid."
      width="max-w-4xl"
      onClose={onClose}
    />
  );
}

/** What a card is still holding, under its amount on the account tile. */
function waiting(c) {
  if (!(c.waiting_cents > 0)) return null;
  return (
    <div className="truncate text-[10px] text-faint" title={waitingTitle(c)}>
      <span className="font-mono tnum">{formatMoney(c.waiting_cents, { compact: true })}</span> waiting
    </div>
  );
}

// D331: Amex prints the balance as of an earlier day; say what has been paid out since.
function waitingTitle(c) {
  const base = `${formatMoney(c.waiting_cents)} waiting: balance as of ${formatShortDate(c.waiting_as_of)}`;
  return c.waiting_paid_since_cents > 0 ? `${base}, less ${formatMoney(c.waiting_paid_since_cents)} paid out since` : base;
}

function describe(item, card, openGift) {
  const icon = <MerchantAvatar merchant={item.merchant} description={item.description} txnType="cashback" amountCents={item.amount_cents} categoryName="Cashback" clickable={false} size={22} />;
  // A gift card (D330): entered by hand, so it opens its form, not a transaction.
  if (item.source === 'redemption') {
    const { cost_cents, points, extra_cents } = giftCardSub(item);
    const cost = [cost_cents != null && `for ${formatMoney(cost_cents)}`, points && `for ${points}`].filter(Boolean)[0];
    const extra = extra_cents > 0 ? ` · ${formatMoney(extra_cents)} extra` : '';
    return {
      title: `${item.brand} gift card`,
      icon: card ? <CardThumb card={card} small /> : icon,
      sub: `${formatShortDate(item.posted_date)}${cost ? ` · ${cost}` : ''}${extra}`,
      opens: false,
      onOpen: () => openGift(item),
      openTitle: 'Change or remove this gift card',
    };
  }
  // Not a transaction: read off the statement (or worked out from its rows, D330), so there's no row to open.
  if (item.source === 'statement') {
    return { title: item.calculated ? `${item.rate_bps / 100}% cash back` : 'Daily Cash', icon: card ? <CardThumb card={card} small /> : icon, sub: `From the ${MONTHS[Number(item.posted_date.slice(5, 7)) - 1]} statement`, opens: false };
  }
  // A payout's bank line ("CASH REWARDS - STMT CRD WILMINGTON") says less than the card it came from.
  if (item.kind === 'rewards' && card) return { title: 'Rewards paid out', icon: <CardThumb card={card} small /> };
  return { icon };
}
