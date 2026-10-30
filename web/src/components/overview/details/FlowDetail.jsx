import { useState } from 'react';
import { api, formatMoney } from '../../../api';
import { useApi } from '../../../hooks/use-api';
import { DetailDialog } from '../../ui/DetailDialog';
import { YearSwitch, MonthBars, Comparison, Explorer } from './MoneyExplorer';
import { MONTHS, NO_FILTER, signed } from '../../../lib/overview/explorer';
import { Loading } from '../../ui/Loading';

/**
 * Investment and To India, in full (D286): money the household moved out
 * on purpose — into Robinhood, home to India — on the shared year explorer
 * (MoneyExplorer.jsx). Neither is spending, so money out stays ink, as on
 * their Overview tiles, and the year before is "more" or "less", not better
 * or worse. Beside the year: everything moved since the first one on file.
 */

const FLOWS = {
  investment: {
    title: 'Investment',
    emoji: '📊',
    tint: 'bg-vivid-blue/10',
    load: (year) => api.investment(year),
    kinds: [
      { key: 'pulled', label: 'Pulled by Robinhood' },
      { key: 'instant', label: 'Sent instantly' },
      { key: 'back', label: 'Taken back out' },
      { key: 'other', label: 'Other' },
    ],
    noun: ['move', 'moves'],
    verb: 'had put in',
    sinceLabel: 'Put in since',
    empty: 'Nothing moved into investments this year.',
    note: "Money moved into investing (Robinhood) from your bank accounts, and anything taken back out. It's yours either way, so it isn't spending; what it's worth now isn't tracked here.",
  },
  india: {
    title: 'To India',
    emoji: '🌏',
    tint: 'bg-vivid-teal/10',
    load: (year) => api.india(year),
    kinds: [
      { key: 'remitly', label: 'Remitly' },
      { key: 'frex', label: 'Frex' },
      { key: 'tribe', label: 'Tribe' },
      { key: 'crobo', label: 'Crobo' },
      { key: 'other', label: 'Other' },
    ],
    noun: ['transfer', 'transfers'],
    verb: 'had sent',
    sinceLabel: 'Sent since',
    empty: 'Nothing sent to India this year.',
    note: 'Money sent home to India, by the service that carried it, from the transactions you filed under Transfer to India.',
  },
};

export function FlowDetail({ flow, month, onClose }) {
  const f = FLOWS[flow];
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [filter, setFilter] = useState(NO_FILTER);
  const { data } = useApi(`${flow}:${year}`, () => f.load(year), { tags: ['transactions'] });

  const years = data?.years?.length ? data.years : [year];
  const pickYear = (y) => { setYear(y); setFilter(NO_FILTER); };
  const toggle = (key, value) => setFilter((x) => ({ ...x, [key]: x[key] === value ? null : value }));
  const since = data?.first_date && `${f.sinceLabel} ${MONTHS[Number(data.first_date.slice(5, 7)) - 1]} ${data.first_date.slice(0, 4)}`;

  return (
    <DetailDialog
      title={f.title}
      emoji={f.emoji}
      tint={f.tint}
      actions={years.length > 1 && <YearSwitch years={years} year={year} onChange={pickYear} />}
      hero={data && { label: data.through_month < 12 ? `${year} so far` : `In ${year}`, value: data.total_cents ? signed(data.total_cents) : '—', tone: 'ink' }}
      side={since && data.all_time_cents && { label: since, value: formatMoney(Math.abs(data.all_time_cents)), tone: 'ink' }}
      sections={[
        {
          key: 'explore',
          label: 'Month by month',
          content: data ? (
            <>
              <MonthBars months={data.months} through={data.through_month} kinds={f.kinds} tone="ink" picked={filter.month} onPick={(m) => toggle('month', m)} empty={f.empty} />
              <Comparison data={data} verb={f.verb} tone="ink" />
              <Explorer
                data={data}
                kinds={f.kinds}
                filter={filter}
                toggle={toggle}
                clear={() => setFilter(NO_FILTER)}
                onClose={onClose}
                noun={f.noun}
                outTone="ink"
              />
            </>
          ) : <Loading />,
        },
      ]}
      note={f.note}
      width="max-w-4xl"
      onClose={onClose}
    />
  );
}
