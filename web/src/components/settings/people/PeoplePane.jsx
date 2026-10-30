import { useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api, maskName } from '../../../api';
import { useApi } from '../../../hooks/use-api';
import { useNotify } from '../../../hooks/use-notify';
import { useConfirm } from '../../../hooks/use-confirm';
import { useDesign } from '../../../hooks/use-design';
import { useWide } from '../../../hooks/use-wide';
import { moveSelection } from '../apple/list-keys';
import { PaneActionSlot } from '../pane-action';
import { PersonPoster } from './PersonPoster';
import { PersonDetail } from './PersonDetail';
import { Rise } from './motion-bits';
import { Button } from '../../ui/Form';

/**
 * Settings → People (D302), the same split view as Accounts and Loans: the
 * household as poster cards beside the chosen person, everything their
 * statements say about them. The selection lives in the URL
 * (?tab=people&person=2). A household is two or three people, so every
 * profile is read at once; the posters' statement counts come from them.
 *
 * Motion runs in every design here, Classic included, at the owner's
 * request (the third Classic exception, web/CLAUDE.md); Reduce Motion
 * still stops all of it.
 */
export function PeoplePane({ people, accounts, onChange }) {
  const [params, setParams] = useSearchParams();
  const { design } = useDesign();
  const still = Boolean(useReducedMotion());
  const wide = useWide('(min-width: 1024px)');
  const notify = useNotify();
  const confirm = useConfirm();
  const [mode, setMode] = useState('view'); // view | edit | add
  const dirty = useRef(false);
  const onDirty = useCallback((d) => { dirty.current = d; }, []);

  const ids = people.map((p) => p.id).join(',');
  const req = useApi(ids ? `people-profiles:${ids}` : null, () => Promise.all(people.map((p) => api.personProfile(p.id))), { tags: ['transactions'] });
  const profiles = new Map((req.loading ? [] : req.data ?? []).map((p) => [p.person.id, p]));

  const navigate = useNavigate();
  // Sent here by Import after a statement added someone new (D399): check them, then go back to it.
  const returnTo = params.get('back');
  const checking = params.get('check') === '1' && returnTo?.startsWith('/') && !returnTo.startsWith('//');
  const chosenId = Number(params.get('person')) || null;
  const chosen = people.find((p) => p.id === chosenId) ?? null;
  const selected = chosen ?? people[0] ?? null;

  // Leaving an edit with changes asks first, in the app's own sheet (D312).
  const leave = async (then) => {
    if (dirty.current && !(await confirm({ title: 'Discard your changes to this person?', confirm: 'Discard', destructive: true }))) return;
    dirty.current = false;
    setMode('view');
    then?.();
  };
  const select = (id) => leave(() => setParams({ tab: 'people', person: String(id) }));
  const back = () => leave(() => setParams({ tab: 'people' }));

  const saved = (person, changes) => {
    dirty.current = false;
    setMode('view');
    onChange();
    req.reload();
    notify(maskName(person.name), { name: changes ? 'person.saved' : 'person.added' });
    if (!changes) setParams({ tab: 'people', person: String(person.id) });
  };

  const detailOpen = Boolean(chosen) || mode === 'add';
  const accountsOf = (id) => accounts.filter((a) => a.person_id === id);

  const slot = useContext(PaneActionSlot);
  const addButton = (
    <span className="apple-pane">
    <button
      type="button"
      onClick={() => leave(() => setMode('add'))}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-info/10 px-3.5 py-1.5 text-[15px] font-medium text-info transition-colors duration-150 hover:bg-info/15 active:bg-info/20"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      Add Person
    </button>
    </span>
  );

  return (
    <>
    {slot ? createPortal(addButton, slot) : (
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted tnum">
          {people.length} {people.length === 1 ? 'person' : 'people'} · {accounts.length} accounts, one shared ledger
        </p>
        {addButton}
      </div>
    )}
    <div className="apple-pane lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <nav aria-label="People" className={detailOpen ? 'hidden lg:block' : ''}>
        <ul className="space-y-3" onKeyDown={(e) => moveSelection(e, select)}>
          {people.map((p, i) => (
            <li key={p.id}>
              <Rise still={still} index={i}>
                <PersonPoster
                  person={p}
                  accounts={accountsOf(p.id)}
                  statements={profiles.get(p.id)?.statements.count ?? null}
                  selected={mode !== 'add' && (wide ? selected?.id : chosen?.id) === p.id}
                  onSelect={select}
                  still={still}
                />
              </Rise>
            </li>
          ))}
        </ul>
        {people.length === 0 && <p className="py-10 text-center text-[13px] text-muted">Add the first person; their accounts and statements follow.</p>}
      </nav>

      <section aria-label={mode === 'add' ? 'New person' : selected ? maskName(selected.name) : 'Person'} className={`split-detail ${detailOpen ? '' : 'hidden lg:block'}`}>
        <button
          type="button"
          onClick={() => (mode === 'add' ? leave() : back())}
          className="mb-4 flex items-center gap-1 rounded-md text-[15px] text-info lg:hidden"
        >
          <svg width="9" height="15" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          People
        </button>
        <motion.div
          key={mode === 'add' ? 'new' : selected?.id ?? 'none'}
          initial={still ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
        >
          {checking && selected && mode !== 'add' && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-raised p-4">
              <p className="min-w-0 flex-1 text-sm text-ink">
                New from a statement: <span className="font-medium">{maskName(selected.name)}</span>, as it printed them.
                Check their name, edit anything that's wrong, then go back to the statement. Their address and
                other details fill in as their statements are approved.
              </p>
              <Button onClick={() => leave(() => navigate(returnTo))}>Back to the statement</Button>
            </div>
          )}
          {mode === 'add' || selected ? (
            <PersonDetail
              person={mode === 'add' ? null : selected}
              profile={mode === 'add' || !selected ? null : profiles.get(selected.id) ?? null}
              mode={mode}
              design={design}
              still={still}
              onEdit={() => setMode('edit')}
              onCancel={() => leave()}
              onSaved={saved}
              onDirty={onDirty}
            />
          ) : null}
        </motion.div>
      </section>
    </div>
    </>
  );
}
