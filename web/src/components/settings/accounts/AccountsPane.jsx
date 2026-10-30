import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '../../../api';
import { useAccountFilters } from '../../../lib/cards/account-filters';
import { useNotify } from '../../../hooks/use-notify';
import { useConfirm } from '../../../hooks/use-confirm';
import { useDesign } from '../../../hooks/use-design';
import { useWide } from '../../../hooks/use-wide';
import { AccountList } from './AccountList';
import { MergeSuggestions } from './MergeSuggestions';
import { AccountDetail } from './AccountDetail';
import { AccountFilterBar } from '../../ui/AccountFilters';
import { PaneActionSlot } from '../pane-action';

/**
 * Settings → Accounts (D297), one pane for every design: a split view after
 * macOS System Settings. The list sits beside the selected account's
 * detail from `lg` up; below that the list fills the screen and a row
 * pushes its detail, with "Accounts" to come back (split-views.md: "Prefer
 * using a split view in a regular — not a compact — environment").
 *
 * The selection lives in the URL (?tab=accounts&account=12), so Back, a
 * reload or a link from elsewhere lands on the same account. On a wide
 * screen with nothing chosen the first account shows, as Settings opens on
 * its first pane; that's shown, not written to the URL, so a phone still
 * opens on the list.
 *
 * The detail reads until Edit, then edits in place; Add opens it empty. Leaving an
 * edit with changes asks first. Closing needs no alert because it's
 * reversible: the toast carries Undo (alerts.md: never for "common
 * undoable actions"). Closed accounts aren't in the app's own list, so
 * they're fetched here. Motion is Vivid's and Glass's only: Classic stays
 * still (CLAUDE.md).
 */
export function Accounts({ accounts, people, onChange }) {
  const [params, setParams] = useSearchParams();
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  // Where list and detail sit side by side (lg); below it the list stands alone.
  const wide = useWide('(min-width: 1024px)');
  const notify = useNotify();
  const confirm = useConfirm();
  const [closed, setClosed] = useState([]);
  const [mode, setMode] = useState('view'); // view | edit | add
  const dirty = useRef(false);
  const onDirty = useCallback((d) => { dirty.current = d; }, []);

  const loadClosed = useCallback(() => {
    api.accounts.list(true).then((all) => setClosed(all.filter((a) => !a.is_active))).catch(() => setClosed([]));
  }, []);
  useEffect(loadClosed, [loadClosed]);
  const refresh = () => { onChange(); loadClosed(); };

  const chosenId = Number(params.get('account')) || null;
  const all = [...accounts, ...closed];
  // The Cards page's own filters (D297): type and person, full names, one rule for both pages.
  const f = useAccountFilters(all, people);
  const shown = accounts.filter((a) => f.visibleIds.has(a.id));
  const shownClosed = closed.filter((a) => f.visibleIds.has(a.id));
  const filtered = f.typeFilter !== 'ALL' || f.personFilter !== 'ALL';
  const clearFilters = () => { f.setTypeFilter('ALL'); f.setPersonFilter('ALL'); };
  const chosen = all.find((a) => a.id === chosenId) ?? null;
  // Wide screens show something even before a choice; it isn't put in the URL.
  const selected = chosen ?? shown[0] ?? null;

  /** Leaving an edit with changes asks first; nothing else does. */
  // Leaving an edit with changes asks first, in the app's own sheet (D312).
  const leave = async (then) => {
    if (dirty.current && !(await confirm({ title: 'Discard your changes to this account?', confirm: 'Discard', destructive: true }))) return;
    dirty.current = false;
    setMode('view');
    then?.();
  };
  const select = (id) => leave(() => setParams({ tab: 'accounts', account: String(id) }));
  const back = () => leave(() => setParams({ tab: 'accounts' }));

  const saved = (account, changes) => {
    dirty.current = false;
    setMode('view');
    refresh();
    notify(account.name, { name: changes ? 'account.saved' : 'account.added' });
    if (!changes) setParams({ tab: 'accounts', account: String(account.id) });
  };

  const setOpen = async (account, open, undoing = false) => {
    try {
      await api.accounts.update(account.id, { is_active: open });
      refresh();
      notify(account.name, {
        name: open ? 'account.reopened' : 'account.closed',
        action: undoing ? null : { label: 'Undo', onClick: () => setOpen(account, !open, true) },
      });
    } catch (err) {
      notify(`${account.name}: ${err.message}`, { name: open ? 'error.reopen' : 'error.close' });
    }
  };

  const detailOpen = Boolean(chosen) || mode === 'add';
  const still = design === 'classic' || reduceMotion;

  const detail = mode === 'add' || selected ? (
    <AccountDetail
      account={mode === 'add' ? null : selected}
      mode={mode}
      people={people}
      all={all}
      start={{ person_id: f.personFilter === 'ALL' ? undefined : f.personFilter, account_type: { BANK: 'CHECKING', CREDIT_CARD: 'CREDIT_CARD' }[f.typeFilter] }}
      still={still}
      onMembersChanged={refresh}
      onEdit={() => setMode('edit')}
      onCancel={() => leave()}
      onSaved={saved}
      onDirty={onDirty}
      onSelect={select}
      onSetOpen={setOpen}
      onBalanceSaved={() => { refresh(); notify(selected.name, { name: 'account.balance' }); }}
    />
  ) : (
    <p className="py-16 text-center text-[13px] text-muted">Add a card or bank account, then upload a statement to fill it with history.</p>
  );

  // Add Account sits opposite the pane's title: in Glass's header (its slot),
  // elsewhere at the top of the pane, across from the counts.
  const slot = useContext(PaneActionSlot);
  // Its own focus scope: in Glass it's portalled into the header, outside the pane's.
  const addButton = (
    <span className="apple-pane">
    <button
      type="button"
      onClick={() => leave(() => setMode('add'))}
      className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-3.5 py-1.5 text-[15px] font-medium text-info transition-colors duration-150 hover:bg-info/15 active:bg-info/20"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      Add Account
    </button>
    </span>
  );

  return (
    <>
    {slot ? createPortal(addButton, slot) : (
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted tnum">
          {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}{closed.length > 0 ? ` · ${closed.length} closed` : ''}
        </p>
        {addButton}
      </div>
    )}
    <MergeSuggestions onMerged={refresh} />
    <div className="apple-pane lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <nav aria-label="Accounts" className={detailOpen ? 'hidden lg:block' : ''}>
        <AccountList
          accounts={shown}
          closed={shownClosed}
          people={people}
          filters={
            <AccountFilterBar size="md" typeFilter={f.typeFilter} onTypeFilter={f.setTypeFilter}
              personFilter={f.personFilter} onPersonFilter={f.setPersonFilter} personOptions={f.personOptions} />
          }
          filtered={filtered}
          onClearFilters={clearFilters}
          showOwner={f.personFilter === 'ALL' && people.length > 1}
          // On a phone only a chosen row is selected; the wide fallback isn't open there.
          selectedId={mode === 'add' ? null : wide ? selected?.id : chosen?.id}
          onSelect={select}
        />
      </nav>

      <section aria-label={mode === 'add' ? 'New account' : selected?.name ?? 'Account'} className={`split-detail ${detailOpen ? '' : 'hidden lg:block'}`}>
        <button
          type="button"
          onClick={() => (mode === 'add' ? leave() : back())}
          className="mb-4 flex items-center gap-1 rounded-md text-[15px] text-info lg:hidden"
        >
          <svg width="9" height="15" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Accounts
        </button>
        <motion.div
          // Edit happens in place; only another account (or Add) fades in anew.
          key={mode === 'add' ? 'new' : selected?.id ?? 'none'}
          initial={still ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
        >
          {detail}
        </motion.div>
      </section>
    </div>
    </>
  );
}
