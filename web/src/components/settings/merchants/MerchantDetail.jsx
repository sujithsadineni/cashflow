import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { TXN_TYPE_LABELS, formatShortDate } from '../../../api';
import { iconSource, renamePreview, sourceWords } from '../../../lib/merchants/merchant-list';
import { lookupMerchantDomain } from '../../../lib/transactions/merchant-logos';
import { MerchantAvatar } from '../../ui/MerchantAvatar';
import { GroupBlock, GroupRow, RowChevron } from '../apple/grouped';
import { LogoPicker } from './LogoPicker';

/**
 * One merchant (D300). Two things about it can change, each the way Apple
 * changes it: its logo through a picker that applies at once, as a contact's
 * photo does (D301: search for it, its website, or an image, which can also
 * be dropped on the logo), and its name through Edit, in place in the title
 * (Contacts). A
 * name that's another merchant's is a merge: as it's typed the footer says
 * so, and Done becomes Merge. Everything else is what the app learned from
 * its transactions (D189), read-only, with how to change it underneath.
 */

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16 } };
const typeWord = (t) => TXN_TYPE_LABELS[t] ?? t ?? '—';
const SHOWN_LINES = 6;

function Actions({ editing, label, busy, canSave, onEdit, onCancel, still }) {
  const pill = 'rounded-full px-3.5 py-1 text-[15px] transition-[background-color,filter,opacity] duration-150';
  const body = editing ? (
    <>
      <button type="button" onClick={onCancel} disabled={busy} className={`${pill} text-info hover:bg-info/10 active:bg-info/15`}>Cancel</button>
      <button type="submit" disabled={busy || !canSave} className={`${pill} bg-info font-semibold text-white hover:brightness-110 active:brightness-95 disabled:opacity-40`}>{busy ? 'Saving…' : label}</button>
    </>
  ) : (
    <button type="button" onClick={onEdit} className={`${pill} text-info hover:bg-info/10 active:bg-info/15`}>Edit</button>
  );
  if (still) return <div className="flex items-center gap-1.5">{body}</div>;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={editing ? 'editing' : 'reading'} className="flex items-center gap-1.5" {...fade}>{body}</motion.div>
    </AnimatePresence>
  );
}

export function MerchantDetail({ merchant, icon, merchants, editing, still, onEdit, onCancel, onRename, onPickIcon, onDirty }) {
  const [name, setName] = useState(merchant.merchant);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [allLines, setAllLines] = useState(false);
  const [dropping, setDropping] = useState(false);
  // A fresh name each time Edit begins.
  const [session, setSession] = useState(null);
  const key = editing ? merchant.merchant : null;
  if (session !== key) { setSession(key); setName(merchant.merchant); setError(null); }
  const preview = editing ? renamePreview(merchant.merchant, name, merchants) : null;
  const dirty = editing && !preview?.same;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  const source = iconSource(merchant.merchant, icon);
  const category = merchant.out?.category ?? merchant.back?.category ?? null;
  const lines = merchant.aliases ?? [];

  async function submit(e) {
    e.preventDefault();
    if (!editing || !preview || preview.error) return;
    if (preview.same) return onCancel();
    setBusy(true);
    setError(null);
    try {
      await onRename(merchant.merchant, preview.to);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const n = merchant.transaction_count;
  const editFooter = preview?.error
    ? <span className="text-spend">{preview.error}</span>
    : preview?.merge
      ? <span>Merges into <b className="font-medium text-ink">{preview.to}</b>: its {n} {n === 1 ? 'transaction joins' : 'transactions join'} that merchant's {preview.intoCount}. Undo puts them back.</span>
      : preview?.to ? `Renames it on its ${n} ${n === 1 ? 'transaction' : 'transactions'}. New statements learn the new name.` : null;

  return (
    <form onSubmit={submit} onKeyDown={(e) => editing && e.key === 'Escape' && onCancel()} noValidate>
      <header className="mb-7 flex flex-wrap items-center gap-x-5 gap-y-4">
        <div className="order-first flex w-full justify-end sm:order-2 sm:w-auto sm:self-start">
          <Actions editing={editing} label={preview?.merge ? 'Merge' : 'Done'} busy={busy} canSave={Boolean(preview && !preview.error)} onEdit={onEdit} onCancel={onCancel} still={still} />
        </div>
        {/* Drop an image here to upload it as the logo (D301). */}
        <span
          onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const f = [...e.dataTransfer.files].find((x) => /^image\/(png|jpeg|webp)$/.test(x.type));
            if (f) onPickIcon({ photo: f });
          }}
          title="Drop an image to use it as the logo"
          className={`overflow-hidden rounded-[18px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_6px_16px_-8px_rgb(0_0_0/0.35)] transition-[box-shadow,transform] duration-150 ${dropping ? 'scale-105 ring-4 ring-info/60' : ''}`}
        >
          <MerchantAvatar merchant={merchant.merchant} categoryName={category} size={72} clickable={false} />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              rows={1}
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }}
              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
              autoFocus
              aria-label="Name"
              aria-invalid={Boolean(preview?.error) || undefined}
              autoComplete="off"
              className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-lg bg-band px-2 py-0.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink outline-none"
            />
          ) : (
            <h3 className="-mx-2 line-clamp-2 rounded-lg px-2 py-0.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] break-words text-ink" title={merchant.merchant}>{merchant.merchant}</h3>
          )}
          <p className="mt-1 truncate text-[13px] text-muted">{[category, `${n} ${n === 1 ? 'transaction' : 'transactions'}`].filter(Boolean).join(' · ')}</p>
        </div>
        {editing && editFooter && <p className="order-last w-full text-[13px] leading-snug text-muted">{editFooter}</p>}
        {error && <p role="alert" className="order-last w-full text-[13px] text-spend">{error}</p>}
      </header>

      <div className="space-y-7">
        <GroupBlock header="Logo" footer="Shows wherever this merchant appears. Without one, it shows its category's icon.">
          <GroupRow label="Shows"><span className="truncate text-ink">{sourceWords(source)}</span></GroupRow>
          <LogoPicker
            merchant={merchant.merchant}
            source={source}
            hasKnownLogo={Boolean(lookupMerchantDomain(merchant.merchant))}
            onPick={onPickIcon}
            trigger={(props) => (
              <button type="button" {...props} className="flex min-h-11 w-full items-center justify-center px-4 text-[15px] text-info transition-colors hover:bg-band active:bg-band">
                Choose Logo…
              </button>
            )}
          />
        </GroupBlock>

        <GroupBlock
          header="Recognised as"
          footer={lines.length > SHOWN_LINES
            ? <button type="button" onClick={() => setAllLines(!allLines)} className="rounded-md text-info hover:underline">{allLines ? 'Show fewer' : `Show all ${lines.length}`}</button>
            : 'The bank lines it\'s named from. A new statement line like these gets this name.'}
        >
          {(allLines ? lines : lines.slice(0, SHOWN_LINES)).map((a) => (
            <GroupRow key={a.line} label={<span className="font-mono text-[13px]">{a.line}</span>}>
              <span className="text-faint tnum">×{a.n}</span>
            </GroupRow>
          ))}
        </GroupBlock>

        <GroupBlock header="Usually" footer="Learned from its transactions. Fix one and this follows; the next statement uses it.">
          <GroupRow label="Money out">
            {merchant.out ? <span className="truncate text-ink">{merchant.out.category ?? 'No category'} · {typeWord(merchant.out.type)}</span> : <span className="text-faint">None</span>}
          </GroupRow>
          {merchant.back && (
            <GroupRow label="Money back"><span className="truncate text-ink">{merchant.back.category ?? 'No category'} · {typeWord(merchant.back.type)}</span></GroupRow>
          )}
        </GroupBlock>

        <GroupBlock header="Activity">
          <Link to={`/transactions?q=${encodeURIComponent(merchant.merchant)}`} className="block transition-colors hover:bg-band active:bg-band">
            <GroupRow label="Transactions"><span className="text-ink tnum">{n.toLocaleString()}</span><RowChevron /></GroupRow>
          </Link>
          <GroupRow label="First seen"><span className="text-ink tnum">{formatShortDate(merchant.first_seen?.slice(0, 10))} {merchant.first_seen?.slice(0, 4)}</span></GroupRow>
          <GroupRow label="Last seen"><span className="text-ink tnum">{formatShortDate(merchant.last_seen?.slice(0, 10))} {merchant.last_seen?.slice(0, 4)}</span></GroupRow>
        </GroupBlock>
      </div>
    </form>
  );
}
