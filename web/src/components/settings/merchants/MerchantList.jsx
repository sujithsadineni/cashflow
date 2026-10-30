import { useState } from 'react';
import { Segmented } from '../../ui/Form';
import { MerchantAvatar } from '../../ui/MerchantAvatar';
import { FILTERS } from '../../../lib/merchants/merchant-list';
import { ListRow } from '../apple/SplitList';
import { moveSelection } from '../apple/list-keys';
import { SearchField } from '../apple/SearchField';

/**
 * The list side of Settings → Merchants (D300). 458 merchants and growing,
 * so a search field leads (it matches a name or any bank line), then what's
 * left to do: Needs an Icon by default, most-used first, so the few that show
 * up often come before the one-offs. Rows show what a merchant usually is and
 * how often it appears. Long lists show the first 60, then the rest on ask.
 */

const PAGE = 60;

export function MerchantList({ rows, counts, filter, onFilter, search, onSearch, selectedId, onSelect }) {
  const [shown, setShown] = useState(PAGE);
  const visible = rows.slice(0, Math.max(shown, rows.findIndex((r) => r.merchant === selectedId) + 1));
  return (
    <div className="space-y-4">
      <SearchField value={search} onChange={(v) => { onSearch(v); setShown(PAGE); }} placeholder="Search merchants or bank lines" label="Search merchants" />
      <Segmented
        value={filter}
        onChange={(v) => { onFilter(v); setShown(PAGE); }}
        options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} · ${counts[f.value].toLocaleString()}` }))}
      />
      {rows.length === 0 ? (
        <p className="px-3 text-[13px] text-muted">
          {search.trim() ? `No merchant or bank line matches “${search.trim()}”.` : filter === 'needs' ? 'Every merchant has a picture.' : 'No merchants yet.'}
        </p>
      ) : (
        <ul onKeyDown={(e) => moveSelection(e, (i) => onSelect(rows[i]?.merchant))}>
          {visible.map((m, i) => (
            <ListRow
              key={m.merchant}
              id={i}
              selected={m.merchant === selectedId}
              afterSelected={i > 0 && visible[i - 1].merchant === selectedId}
              onSelect={() => onSelect(m.merchant)}
              leading={<span className="flex size-[30px] shrink-0 items-center justify-center"><MerchantAvatar merchant={m.merchant} categoryName={m.out?.category ?? m.back?.category} size={30} clickable={false} /></span>}
              title={m.merchant}
              subtitle={m.out?.category ?? m.back?.category ?? ''}
              trailing={(selected) => <span className={`shrink-0 text-[13px] tnum ${selected ? 'text-white/85' : 'text-muted'}`}>{m.transaction_count}</span>}
            />
          ))}
        </ul>
      )}
      {visible.length < rows.length && (
        <button type="button" onClick={() => setShown(shown + PAGE * 2)} className="mx-3 rounded-md text-[13px] text-info hover:underline">
          Show {Math.min(PAGE * 2, rows.length - visible.length)} more of {rows.length.toLocaleString()}
        </button>
      )}
    </div>
  );
}
