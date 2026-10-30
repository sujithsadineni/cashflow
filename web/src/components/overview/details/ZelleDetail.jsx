import { useState } from 'react';
import { api } from '../../../api';
import { useApi } from '../../../hooks/use-api';
import { DetailDialog } from '../../ui/DetailDialog';
import { MerchantAvatar } from '../../ui/MerchantAvatar';
import { ZelleReview } from '../../review/ZelleReview';
import { ContactsManager } from '../../settings/ContactsManager';
import { YearSwitch, MonthBars, Comparison, Explorer } from './MoneyExplorer';
import { NO_FILTER, signed } from '../../../lib/overview/explorer';
import { Loading } from '../../ui/Loading';

/**
 * Zelle Transfers, in full (D288), on the shared year explorer
 * (MoneyExplorer.jsx). Zelle is about people, so the second row of tiles
 * is who the money went to or came from (most moved first, twelve then
 * "Show all"), not the two or three bank accounts it went through.
 *
 * Sent and received are counted as everywhere else (sent is spending,
 * received is income); between your own accounts is shown as what moved,
 * in ink, and counted in neither. The bars are how much moved by Zelle.
 *
 * Sorting a Zelle (sent, received or between you, and who) is the review
 * tool's job, one row at a time: it's the Review button here, and the card
 * opens on it when rows are waiting.
 */

const KINDS = [
  { key: 'sent', label: 'Sent' },
  { key: 'received', label: 'Received' },
  { key: 'internal', label: 'Between you', ink: true },
  { key: 'unreviewed', label: 'Not reviewed', ink: true },
];

const contactOf = (i) => (i.contact_id ? { id: i.contact_id, name: i.contact_name, nickname: i.contact_nickname, image_path: i.contact_image_path } : null);
const sum = (rows) => rows.reduce((a, r) => a + r.amount_cents, 0);

export function ZelleDetail({ month, onClose, onChanged, startInReview = false }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [filter, setFilter] = useState(NO_FILTER);
  const [reviewing, setReviewing] = useState(startInReview);
  const [names, setNames] = useState(false);
  const { data, reload } = useApi(`zelle:${year}`, () => api.zelleYear(year), { tags: ['transactions'] });
  // Names that may be one person (D290), counted on the Names button.
  const { data: similar, reload: reloadSimilar } = useApi('contacts:similar', () => api.contacts.similar());

  if (reviewing) {
    return <ZelleReview onClose={() => { setReviewing(false); reload(); }} onChanged={onChanged} />;
  }

  const years = data?.years?.length ? data.years : [year];
  const pickYear = (y) => { setYear(y); setFilter(NO_FILTER); };
  const toggle = (key, value) => setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));
  const waiting = data?.needs_review ?? 0;

  const people = data && {
    label: 'People',
    hint: 'a person',
    field: 'person_key',
    limit: 12,
    tiles: data.people.map((p) => ({
      key: p.key,
      name: p.name,
      thumb: <MerchantAvatar contact={p.contact_id ? { id: p.contact_id, name: p.name, image_path: p.image_path } : null} description="Zelle" clickable={false} size={24} />,
      amount: (rows) => <PersonAmounts rows={rows} />,
    })),
  };

  return (
    <>
    {names && <ContactsManager onClose={() => { setNames(false); reloadSimilar(); reload(); }} onChanged={() => { reloadSimilar(); reload(); onChanged?.(); }} />}
    <DetailDialog
      title="Zelle Transfers"
      emoji="💸"
      tint="bg-vivid-pink/10"
      actions={(
        <>
          {years.length > 1 && <YearSwitch years={years} year={year} onChange={pickYear} />}
          <button
            onClick={() => setNames(true)}
            className="flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-sm text-ink transition-colors hover:border-rule-str hover:bg-band"
          >
            Names
            {similar?.length > 0 && <span className="rounded-full bg-band px-1.5 font-mono text-[11px] text-muted tnum">{similar.length}</span>}
          </button>
          <button
            onClick={() => setReviewing(true)}
            className="flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-sm text-ink transition-colors hover:border-rule-str hover:bg-band"
          >
            Review
            {waiting > 0 && <span className="rounded-full bg-spend px-1.5 font-mono text-[11px] text-white tnum">{waiting}</span>}
          </button>
        </>
      )}
      hero={data && { label: data.through_month < 12 ? `Received, ${year} so far` : `Received in ${year}`, value: signed(data.by_kind.received), tone: 'earn' }}
      side={data && { label: 'Sent', value: signed(data.by_kind.sent), tone: data.by_kind.sent ? 'spend' : 'ink' }}
      sections={[
        {
          key: 'explore',
          label: 'Moved by Zelle, month by month',
          content: data ? (
            <>
              <MonthBars months={data.months} through={data.through_month} kinds={KINDS} tone="ink" picked={filter.month} onPick={(m) => toggle('month', m)} empty="No Zelle this year." />
              <Comparison data={data} verb="had moved" tone="ink" />
              <Explorer
                data={data}
                kinds={KINDS}
                filter={filter}
                toggle={toggle}
                clear={() => setFilter(NO_FILTER)}
                onClose={onClose}
                noun={['Zelle', 'Zelles']}
                facet={people}
                kindAmount={(kind, rows) => (kind === 'internal' ? sum(rows.filter((r) => r.amount_cents > 0)) : sum(rows))}
                describe={(item) => ({
                  title: item.person_name,
                  icon: <MerchantAvatar contact={contactOf(item)} description="Zelle" clickable={false} size={22} />,
                  tone: item.kind === 'internal' || item.kind === 'unreviewed' ? 'text-ink' : undefined,
                })}
              />
            </>
          ) : <Loading />,
        },
      ]}
      note="Sent counts as spending and received as income, as everywhere in the app; Zelles between your own accounts are shown as what moved and counted in neither. Use Review to sort a new Zelle or fix one."
      width="max-w-4xl"
      onClose={onClose}
    />
    </>
  );
}

/** A person's received and sent under the filters, one line each; between-you only says so. */
function PersonAmounts({ rows }) {
  const received = sum(rows.filter((r) => r.kind === 'received'));
  const sent = sum(rows.filter((r) => r.kind === 'sent'));
  if (!rows.length) return <div className="font-mono text-xs text-faint">—</div>;
  if (!received && !sent) return <div className="text-[11px] text-muted">Between you</div>;
  return (
    <>
      {received !== 0 && <div className="font-mono text-xs text-earn tnum">{signed(received)}</div>}
      {sent !== 0 && <div className="font-mono text-xs text-spend tnum">{signed(sent)}</div>}
    </>
  );
}
