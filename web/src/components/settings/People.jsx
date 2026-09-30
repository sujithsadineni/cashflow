import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api, formatMoney } from '../../api';
import { useDesign } from '../../design-context';
import { useNotify } from '../../notification-context';
import { Button, TextInput, SectionHeader } from '../Form';
import { PersonCard } from '../PersonCard';
import { PersonAvatar } from '../ui/PersonAvatar';

/**
 * Settings → People (moved out of Settings.jsx in D144). Classic keeps
 * its row of initials; Vivid is a household: a family header, then a
 * card per person with their avatar, what they hold, and what they've
 * spent this month. Clicking a person opens PersonCard, where the
 * avatar is picked.
 */

const thisMonth = () => new Date().toISOString().slice(0, 7);

const accountTally = (accounts) => {
  const banks = accounts.filter((a) => a.account_type !== 'CREDIT_CARD').length;
  const cards = accounts.length - banks;
  return [banks > 0 && `🏦 ${banks}`, cards > 0 && `💳 ${cards}`].filter(Boolean).join('  ·  ') || 'No accounts yet';
};

function ClassicPersonButton({ person, accountCount, onClick }) {
  return (
    <button onClick={onClick} className="flex w-28 flex-col items-center gap-2 rounded-lg p-2 text-center transition-colors hover:bg-band">
      <PersonAvatar person={person} size={56} />
      <span className="w-full truncate text-sm text-ink">{person.name}</span>
      <span className="text-xs text-faint tnum">{accountCount} account{accountCount === 1 ? '' : 's'}</span>
    </button>
  );
}

function VividPersonCard({ person, accounts, spentCents, index, onClick }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 300, damping: 24 }}
      className="flex flex-col items-center gap-2 rounded-2xl border border-rule bg-raised p-5 text-center shadow-sm transition-shadow hover:shadow-md"
    >
      <PersonAvatar person={person} size={64} />
      <span className="mt-1 w-full truncate font-medium text-ink">{person.name}</span>
      <span className="text-xs text-muted">{accountTally(accounts)}</span>
      {spentCents != null && (
        <span className="mt-1 rounded-full bg-vivid-red/10 px-2.5 py-1 font-mono text-xs tnum text-vivid-loss">
          {formatMoney(spentCents)} this month
        </span>
      )}
    </motion.button>
  );
}

export function People({ people, accounts, onChange }) {
  const notify = useNotify();
  const vivid = useDesign().design === 'vivid';
  const [newPersonName, setNewPersonName] = useState('');
  const [openPersonId, setOpenPersonId] = useState(null);
  const [spentById, setSpentById] = useState({});

  // This month's net per person — the same figure Overview's by-person
  // line shows, so the two pages never disagree. Vivid only.
  useEffect(() => {
    if (!vivid) return;
    let cancelled = false;
    api
      .summary(thisMonth())
      .then((s) => !cancelled && setSpentById(Object.fromEntries(s.by_person.map((p) => [p.id, p.net_cents]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [vivid]);

  const addPerson = async (e) => {
    e.preventDefault();
    if (!newPersonName.trim()) return;
    await api.personCreate(newPersonName.trim());
    notify(`${newPersonName.trim()} added`, { type: 'success' });
    setNewPersonName('');
    onChange();
  };

  const openPerson = people.find((p) => p.id === openPersonId) ?? null;
  const accountsOf = (id) => accounts.filter((a) => a.person_id === id);

  const addForm = (
    <form onSubmit={addPerson} className="flex justify-center gap-2">
      <TextInput
        value={newPersonName}
        onChange={(e) => setNewPersonName(e.target.value)}
        placeholder="Add a person"
        className="max-w-xs"
      />
      <Button type="submit" size="sm" disabled={!newPersonName.trim()}>
        Add
      </Button>
    </form>
  );

  return (
    <section>
      <SectionHeader title="People" emoji="👥" tint="bg-vivid-green/15" />

      {vivid ? (
        <>
          <div className="mb-5 flex items-center gap-4 rounded-2xl bg-vivid-green/10 p-4">
            <span className="text-4xl leading-none" aria-hidden="true">👨‍👩‍👧</span>
            <div>
              <div className="font-medium text-ink">Your household</div>
              <div className="text-sm text-muted">
                {people.length} {people.length === 1 ? 'person' : 'people'} · {accounts.length} accounts, one shared ledger
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person, i) => (
              <VividPersonCard
                key={person.id}
                person={person}
                accounts={accountsOf(person.id)}
                spentCents={spentById[person.id]}
                index={i}
                onClick={() => setOpenPersonId(person.id)}
              />
            ))}
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-rule-str p-5">
              <span className="text-3xl leading-none" aria-hidden="true">➕</span>
              {addForm}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap justify-center gap-2">
            {people.map((person) => (
              <ClassicPersonButton
                key={person.id}
                person={person}
                accountCount={accountsOf(person.id).length}
                onClick={() => setOpenPersonId(person.id)}
              />
            ))}
          </div>
          <div className="mt-5">{addForm}</div>
        </>
      )}

      {openPerson && (
        <PersonCard person={openPerson} accounts={accounts} onClose={() => setOpenPersonId(null)} onRenamed={onChange} />
      )}
    </section>
  );
}
