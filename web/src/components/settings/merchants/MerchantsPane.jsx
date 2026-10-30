import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { api } from '../../../api';
import { useApi } from '../../../hooks/use-api';
import { useNotify } from '../../../hooks/use-notify';
import { useConfirm } from '../../../hooks/use-confirm';
import { useDesign } from '../../../hooks/use-design';
import { useWide } from '../../../hooks/use-wide';
import { MerchantIconsContext } from '../../../hooks/use-merchant-icons';
import { filterCounts, listMerchants, iconSource } from '../../../lib/merchants/merchant-list';
import { MerchantList } from './MerchantList';
import { MerchantDetail } from './MerchantDetail';
import { Loading } from '../../ui/Loading';

/**
 * Settings → Merchants (D300), the same split view as Accounts and Loans:
 * the list beside the chosen merchant, pushed on a phone, the choice in the
 * URL (?tab=icons&merchant=Costco). Its logo changes through a picker that
 * applies at once (D301: search, a website, or an uploaded image); its name
 * through Edit, where a name that's another merchant's merges the two. Both
 * carry Undo in their toast: a rename or merge puts back exactly the rows it
 * moved; a logo goes back to what it was, unless an uploaded image was
 * involved (a replaced image's file is gone).
 *
 * Icons come from the app-wide icon context, so a change shows on every
 * avatar at once. Motion is Vivid's and Glass's only.
 */
export function MerchantsPane() {
  const [params, setParams] = useSearchParams();
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  const notify = useNotify();
  const confirm = useConfirm();
  const wide = useWide('(min-width: 1024px)');
  const { icons, refresh: refreshIcons } = useContext(MerchantIconsContext);
  const [filter, setFilter] = useState('needs');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const dirty = useRef(false);
  const onDirty = useCallback((d) => { dirty.current = d; }, []);

  const req = useApi('merchants:all', () => api.merchantIcons.allMerchants(), { tags: ['transactions'] });
  const merchants = useMemo(() => req.data ?? [], [req.data]);
  const rows = useMemo(() => listMerchants(merchants, icons, { filter, search }), [merchants, icons, filter, search]);
  const counts = useMemo(() => filterCounts(merchants, icons), [merchants, icons]);

  const chosenName = params.get('merchant');
  const chosen = merchants.find((m) => m.merchant === chosenName) ?? null;
  // Wide screens show the first in the list before a choice; it isn't put in the URL.
  const selected = chosen ?? (wide ? rows[0] ?? null : null);

  // Leaving an edit with changes asks first, in the app's own sheet (D312).
  const leave = async (then) => {
    if (dirty.current && !(await confirm({ title: 'Discard the new name?', confirm: 'Discard', destructive: true }))) return;
    dirty.current = false;
    setEditing(false);
    then?.();
  };
  const select = (name) => leave(() => setParams({ tab: 'icons', merchant: name }));
  const back = () => leave(() => setParams({ tab: 'icons' }));

  const rename = async (from, to) => {
    const done = await api.merchants.rename(from, to);
    dirty.current = false;
    setEditing(false);
    req.reload();
    refreshIcons();
    setParams({ tab: 'icons', merchant: done.to });
    notify(done.merged ? `${from} into ${done.to}` : `${from} → ${done.to}`, {
      name: done.merged ? 'merchant.merged' : 'merchant.renamed',
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            await api.merchants.undoRename(done.audit_id);
            req.reload();
            refreshIcons();
            setParams({ tab: 'icons', merchant: from });
            notify(`${from} is back`, { name: 'undo.done' });
          } catch (err) {
            notify(err.message, { name: 'error.undo' });
          }
        },
      },
    });
  };

  // A choice from the picker, applied at once; Undo restores a website or none.
  const pickIcon = async (merchant, choice) => {
    const before = iconSource(merchant, icons[merchant]);
    const restore = before.kind === 'website' ? { domain: before.domain } : before.kind === 'photo' ? null : { domain: null };
    try {
      if (choice.photo) await api.merchantIcons.uploadImage(merchant, choice.photo);
      else if (choice.removePhoto) await api.merchantIcons.removeImage(merchant);
      else await api.merchantIcons.update(merchant, { domain: choice.clear ? null : choice.domain });
      refreshIcons();
      const undoable = restore && !choice.photo && !choice.removePhoto;
      notify(merchant, {
        name: 'merchant.logo',
        action: undoable ? { label: 'Undo', onClick: async () => { await api.merchantIcons.update(merchant, restore); refreshIcons(); } } : null,
      });
    } catch (err) {
      notify(`${merchant}: ${err.message}`, { name: 'error.save' });
    }
  };

  const still = design === 'classic' || reduceMotion;
  const detailOpen = Boolean(chosen);

  if (req.error) return <p className="text-[13px] text-spend">Couldn't load merchants: {req.error}</p>;

  return (
    <div className="apple-pane lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <nav aria-label="Merchants" className={detailOpen ? 'hidden lg:block' : ''}>
        {req.data ? (
          <MerchantList
            rows={rows}
            counts={counts}
            filter={filter}
            onFilter={setFilter}
            search={search}
            onSearch={setSearch}
            selectedId={selected?.merchant}
            onSelect={select}
          />
        ) : <Loading />}
      </nav>

      <section aria-label={selected?.merchant ?? 'Merchant'} className={`split-detail ${detailOpen ? '' : 'hidden lg:block'}`}>
        <button type="button" onClick={back} className="mb-4 flex items-center gap-1 rounded-md text-[15px] text-info lg:hidden">
          <svg width="9" height="15" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Merchants
        </button>
        {selected ? (
          <motion.div
            key={selected.merchant}
            initial={still ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          >
            <MerchantDetail
              merchant={selected}
              icon={icons[selected.merchant]}
              merchants={merchants}
              editing={editing}
              still={still}
              onEdit={() => setEditing(true)}
              onCancel={() => leave()}
              onRename={rename}
              onPickIcon={(choice) => pickIcon(selected.merchant, choice)}
              onDirty={onDirty}
            />
          </motion.div>
        ) : (
          req.data ? <p className="py-16 text-center text-[13px] text-muted">Pick a merchant to see what the app knows about it.</p> : <Loading className="py-16" />
        )}
      </section>
    </div>
  );
}
