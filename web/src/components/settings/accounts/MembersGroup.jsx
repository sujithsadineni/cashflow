import { useState } from 'react';
import { api, maskName } from '../../../api';
import { useApi, invalidate } from '../../../hooks/use-api';
import { useNotify } from '../../../hooks/use-notify';
import { memberLine, proposedLine, memberFromProposal, addablePeople } from '../../../lib/accounts/members';
import { PersonAvatar } from '../../ui/PersonAvatar';
import { Dropdown } from '../../ui/Dropdown';
import { GroupBlock, GroupRow } from '../apple/grouped';

/**
 * People on a shared card (D344), in Settings → Accounts' detail. Who's on it,
 * how many of its rows are theirs, the names its statements print that nobody
 * accounts for (proposed, never added by themselves: D100), adding someone and
 * taking them off. Each change re-files the card's rows on the server and its
 * toast carries Undo, which puts back exactly the rows it moved.
 */
export function MembersGroup({ account, people, onChanged }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const req = useApi(`members:${account.id}`, () => api.accounts.members(account.id), { tags: ['accounts'] });
  const data = req.data;
  if (!data) return null;

  const person = (id, name) => people.find((p) => p.id === id) ?? { id, name };
  const owner = person(account.person_id, account.person_name);
  const members = data.members.filter((m) => m.is_active && m.person_id !== account.person_id);
  const proposed = data.proposed;
  const addable = addablePeople(account, data.members, people);
  // A card nobody else is on, with nothing proposed and nobody to add, needs no group.
  if (members.length === 0 && proposed.length === 0 && addable.length === 0) return null;

  const rowsWord = (n) => `${Number(n).toLocaleString()} ${Number(n) === 1 ? 'row' : 'rows'}`;
  // Rows moved between people: the card's list, Transactions and Overview all change.
  const changed = () => { req.reload(); onChanged?.(); invalidate('transactions'); };
  const done = (words, result) => {
    changed();
    notify(words, {
      name: 'account.members',
      action: result?.audit_id ? {
        label: 'Undo',
        onClick: async () => {
          await api.accounts.undoMember(account.id, result.audit_id);
          changed();
          notify(account.name, { name: 'undo.done' });
        },
      } : null,
    });
  };
  const run = async (work, words, failed) => {
    setBusy(true);
    try {
      done(words, await work());
    } catch (err) {
      notify(err.message, { name: failed });
    } finally {
      setBusy(false);
    }
  };

  const assign = (p, personId) => run(
    () => api.accounts.addMember(account.id, memberFromProposal(p, personId, account.person_id)),
    `Filed to ${maskName(person(Number(personId)).name)}`,
    'error.save',
  );
  // Added before their section prints: their first section on this card files to them.
  const add = (personId) => run(
    () => api.accounts.addMember(account.id, { person_id: Number(personId), role: 'additional' }),
    `${maskName(person(Number(personId)).name)} added to ${account.name}`,
    'error.add',
  );
  const remove = (m) => run(
    () => api.accounts.updateMember(account.id, m.id, { is_active: false }),
    `${maskName(m.person_name)} taken off ${account.name}`,
    'error.save',
  );

  return (
    <GroupBlock
      header="People on this card"
      footer={members.length > 0 || proposed.length > 0
        ? 'Each row goes to whoever the statement prints it under. Payments stay with the owner; a refund follows the purchase it gives back.'
        : 'Add someone who has their own card on this account, and their section of each statement is theirs.'}
    >
      <GroupRow label={<PersonLabel person={owner} />}>
        <span>Owner</span>
      </GroupRow>
      {members.map((m) => (
        <GroupRow key={m.id} label={<PersonLabel person={person(m.person_id, m.person_name)} />}>
          <span className="min-w-0 truncate tnum">{memberLine(m)}</span>
          <span className="shrink-0 text-faint tnum">{rowsWord(m.rows)}</span>
          <button type="button" disabled={busy} onClick={() => remove(m)}
            className="shrink-0 rounded-md px-1 text-[13px] text-spend transition-opacity hover:opacity-80 disabled:opacity-40">
            Take off
          </button>
        </GroupRow>
      ))}
      {proposed.map((p) => (
        <GroupRow key={`${p.printed_name}|${p.card_ending}`} label={<span className="text-[15px] text-ink">Who is this?</span>}>
          <span className="min-w-0 truncate tnum">{proposedLine({ ...p, printed_name: maskName(p.printed_name ?? '') })}</span>
          <Dropdown inRow value="" onChange={(id) => assign(p, id)} placeholder="Pick" aria-label="Who this name is"
            options={people.map((x) => ({ value: String(x.id), label: maskName(x.name) }))} />
        </GroupRow>
      ))}
      {addable.length > 0 && (
        <GroupRow label={<span className="text-[15px] text-info">Add someone</span>}>
          <Dropdown inRow value="" onChange={add} placeholder="Pick" aria-label="Add someone to this card"
            options={addable.map((x) => ({ value: String(x.id), label: maskName(x.name) }))} />
        </GroupRow>
      )}
    </GroupBlock>
  );
}

function PersonLabel({ person }) {
  return (
    <span className="flex items-center gap-2 text-[15px] text-ink">
      <PersonAvatar person={person} size={22} />
      {maskName(person.name)}
    </span>
  );
}
