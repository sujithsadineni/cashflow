import { useState } from 'react';
import { maskName } from '../../../api';
import { groupAccounts, rowStatus } from '../../../lib/accounts/accounts';
import { PersonAvatar } from '../../ui/PersonAvatar';
import { SharedBadge } from '../../ui/SharedBadge';
import { sharedPeople } from '../../../lib/accounts/members';
import { MiniCard, ListRow, ListSection, ClosedFold } from '../apple/SplitList';
import { moveSelection } from '../apple/list-keys';

/**
 * The list side of Settings → Accounts (D297): grouped Cards and Bank
 * accounts on the shared split-view rows (apple/SplitList.jsx), and closed
 * accounts folded away at the bottom.
 */

const TONE = { spend: 'text-spend', warn: 'text-warn', earn: 'text-earn', muted: 'text-muted' };

export function AccountList({ accounts, closed, people, filters, filtered, onClearFilters, showOwner, selectedId, onSelect }) {
  const [opened, setShowClosed] = useState(false);
  // A closed account that's selected keeps its section open.
  const showClosed = opened || closed.some((a) => a.id === selectedId);
  const ownerOf = (a) => people.find((p) => p.id === a.person_id) ?? { name: a.person_name };
  const groups = groupAccounts(accounts);
  const rows = (list, isClosed = false) => list.map((a, i) => {
    const status = isClosed ? null : rowStatus(a);
    const owner = ownerOf(a);
    const shared = sharedPeople(a, people);
    return (
      <ListRow
        key={a.id}
        id={a.id}
        selected={a.id === selectedId}
        afterSelected={i > 0 && list[i - 1].id === selectedId}
        onSelect={onSelect}
        leading={<MiniCard account={a} />}
        title={a.name}
        // The last four never truncate: they're what tells two same-named cards apart.
        suffix={a.mask && `··${a.mask}`}
        subtitle={[a.issuer, shared && 'Shared', isClosed && 'Closed'].filter(Boolean).join(' · ')}
        dimmed={isClosed}
        trailing={(selected) => (
          <>
            {status && <span className={`shrink-0 text-[13px] tnum ${selected ? 'text-white' : TONE[status.tone]}`}>{status.text}</span>}
            {/* A shared card shows everyone on it (D344); otherwise its owner, when owners are shown. */}
            {shared ? (
              <SharedBadge people={shared} size={22} label={false} onDark={selected} />
            ) : showOwner && owner && (
              <span title={maskName(owner.name)} className="shrink-0">
                <PersonAvatar person={owner} size={22} />
              </span>
            )}
          </>
        )}
      />
    );
  });

  return (
    <div onKeyDown={(e) => moveSelection(e, onSelect)} className="space-y-6">
      {filters}

      {groups.length === 0 && (
        <div className="px-3 text-[13px] text-muted">
          {filtered ? (
            <>
              No open accounts match these filters.{' '}
              <button type="button" onClick={onClearFilters} className="rounded-md text-info hover:underline">Show all</button>
            </>
          ) : 'No accounts yet.'}
        </div>
      )}
      {groups.map((g) => (
        <ListSection key={g.key} label={`${g.label} · ${g.rows.length}`}>
          <ul>{rows(g.rows)}</ul>
        </ListSection>
      ))}

      <ClosedFold count={closed.length} open={showClosed} onToggle={() => setShowClosed(!opened)}>
        {rows(closed, true)}
      </ClosedFold>
    </div>
  );
}
