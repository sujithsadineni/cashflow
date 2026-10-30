import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { useDesign } from '../../../hooks/use-design';
import { useWide } from '../../../hooks/use-wide';
import { useNotify } from '../../../hooks/use-notify';
import { useToastNames } from '../../../hooks/use-toast-names';
import { TOASTS, renamedToasts, toastList, toastName } from '../../../lib/app/toast-names';
import { ListRow, ListSection } from '../apple/SplitList';
import { SearchField } from '../apple/SearchField';
import { moveSelection } from '../apple/list-keys';
import { Loading } from '../../ui/Loading';
import { ToastDetail } from './ToastDetail';
import { ToastLook } from './ToastLook';

const DOT = { success: 'bg-earn', error: 'bg-spend', info: 'bg-faint' };

/**
 * Settings → Notifications (D384): every toast the app raises, grouped by what
 * happened, each with the name it shows. The same split view as Merchants, the
 * choice in the URL (?tab=toasts&toast=account.closed). A name is one thing, so
 * it applies at once (Enter or leaving the field) with Undo, not Edit/Done.
 */
export function ToastsPane() {
  const [params, setParams] = useSearchParams();
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  const wide = useWide('(min-width: 1024px)');
  const notify = useNotify();
  const { saved, rename, restore } = useToastNames();
  const [search, setSearch] = useState('');

  const groups = useMemo(() => toastList(saved, search, design), [saved, search, design]);
  const flat = groups.flatMap((g) => g.items);
  const chosenKey = params.get('toast');
  const chosen = TOASTS[chosenKey] ? chosenKey : null;
  // Wide screens show the first before a choice; it isn't put in the URL.
  const selectedKey = chosen ?? (wide ? flat[0]?.key ?? null : null);
  const select = (key) => setParams({ tab: 'toasts', toast: key });
  const back = () => setParams({ tab: 'toasts' });

  const onRename = (key, name) => {
    const was = toastName(key, saved, design);
    const before = rename(key, name, design);
    const now = toastName(key, renamedToasts(before, key, name, design), design);
    if (now === was) return;
    notify(`${was} → ${now}`, { name: 'toast.renamed', action: { label: 'Undo', onClick: () => restore(before) } });
  };

  const still = design === 'classic' || reduceMotion;
  if (!saved) return <Loading />;

  return (
    <div className="apple-pane">
      {/* The design in use's look and place (D387), then every toast by name. */}
      <ToastLook design={design} saved={saved} />
      <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <nav aria-label="Notifications" className={chosen ? 'hidden lg:block' : ''}>
          <div className="space-y-4">
            <SearchField value={search} onChange={setSearch} placeholder="Search names or pages" label="Search notifications" />
            {groups.length === 0 ? (
              <p className="px-3 text-[13px] text-muted">No notification matches “{search.trim()}”.</p>
            ) : groups.map((g) => (
              <ListSection key={g.key} label={`${g.label} · ${g.items.length}`}>
                <ul onKeyDown={(e) => moveSelection(e, (i) => { const item = flat[i]; if (item) select(item.key); })}>
                  {g.items.map((item, i) => (
                    <ListRow
                      key={item.key}
                      id={flat.indexOf(item)}
                      selected={item.key === selectedKey}
                      afterSelected={i > 0 && g.items[i - 1].key === selectedKey}
                      onSelect={() => select(item.key)}
                      leading={<span className={`size-2 shrink-0 rounded-full ${DOT[item.type]}`} aria-hidden="true" />}
                      title={item.current}
                      subtitle={item.where}
                      trailing={(sel) => item.renamed && <span className={`shrink-0 text-[13px] ${sel ? 'text-white/85' : 'text-muted'}`}>Renamed</span>}
                    />
                  ))}
                </ul>
              </ListSection>
            ))}
          </div>
        </nav>

        <section aria-label={selectedKey ? toastName(selectedKey, saved, design) : 'Notification'} className={`split-detail ${chosen ? '' : 'hidden lg:block'}`}>
          <button type="button" onClick={back} className="mb-4 flex items-center gap-1 rounded-md text-[15px] text-info lg:hidden">
            <svg width="9" height="15" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Notifications
          </button>
          {selectedKey ? (
            <motion.div
              key={selectedKey}
              initial={still ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            >
              <ToastDetail toastKey={selectedKey} saved={saved} design={design} onRename={onRename} />
            </motion.div>
          ) : (
            <p className="py-16 text-center text-[13px] text-muted">Pick a notification to see it and rename it.</p>
          )}
        </section>
      </div>
    </div>
  );
}
