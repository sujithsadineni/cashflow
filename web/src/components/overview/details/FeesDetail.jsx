import { useState } from 'react';
import { api } from '../../../api';
import { useApi } from '../../../hooks/use-api';
import { tidyDescription } from '../../../lib/transactions/txn-name';
import { DetailDialog } from '../../ui/DetailDialog';
import { YearSwitch, MonthBars, Comparison, Explorer } from './MoneyExplorer';
import { NO_FILTER, signed } from '../../../lib/overview/explorer';
import { Loading } from '../../ui/Loading';

/**
 * Fees & Interest, in full (D285): every fee and interest charge less the
 * fees a bank gave back (api/src/money/fees.js), on the shared year explorer
 * (MoneyExplorer.jsx). A fee's merchant is just its issuer, so a row reads
 * by its own bank line ("Balance Transfer Fee"); interest arrives a line a
 * month per card, so each card's is one card that opens into its months.
 */

const KINDS = [
  { key: 'transfer', label: 'Transfer & cash advance fees' },
  { key: 'annual', label: 'Annual fees' },
  { key: 'late', label: 'Late & returned payment' },
  { key: 'account', label: 'Account fees' },
  { key: 'interest', label: 'Interest charged' },
  { key: 'other', label: 'Other fees' },
  { key: 'refund', label: 'Given back' },
];

export function FeesDetail({ month, onClose }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [filter, setFilter] = useState(NO_FILTER);
  const { data } = useApi(`fees:${year}`, () => api.fees(year), { tags: ['transactions'] });

  const years = data?.years?.length ? data.years : [year];
  const pickYear = (y) => { setYear(y); setFilter(NO_FILTER); };
  const toggle = (key, value) => setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));
  const givenBack = data?.by_kind.refund ?? 0;

  return (
    <DetailDialog
      title="Fees & Interest"
      emoji="🧾"
      tint="bg-vivid-red/10"
      actions={years.length > 1 && <YearSwitch years={years} year={year} onChange={pickYear} />}
      hero={data && { label: data.through_month < 12 ? `${year} so far` : `Paid in ${year}`, value: signed(data.total_cents), tone: data.total_cents < 0 ? 'spend' : 'ink' }}
      side={givenBack > 0 && { label: 'Given back by banks', value: signed(givenBack), tone: 'earn' }}
      sections={[
        {
          key: 'explore',
          label: 'Month by month',
          content: data ? (
            <>
              <MonthBars months={data.months} through={data.through_month} kinds={KINDS} tone="spend" picked={filter.month} onPick={(m) => toggle('month', m)} empty="No fees or interest this year." />
              <Comparison data={data} verb="had cost" tone="spend" />
              <Explorer
                data={data}
                kinds={KINDS}
                filter={filter}
                toggle={toggle}
                clear={() => setFilter(NO_FILTER)}
                onClose={onClose}
                noun={['charge', 'charges']}
                grouped={{ interest: 'Interest charged' }}
                describe={(item) => ({ title: tidyDescription(item.description) ?? item.merchant })}
              />
            </>
          ) : <Loading />,
        },
      ]}
      note="Every fee and interest charge on your accounts, less what a bank gave back (a reversed annual fee, a refunded maintenance fee, interest taken off after a dispute). Fees already count in Spent; this is that slice of it."
      width="max-w-4xl"
      onClose={onClose}
    />
  );
}
