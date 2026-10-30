import { useState } from 'react';
import { api, formatTimestamp } from '../../api';
import { useApi, invalidate } from '../../hooks/use-api';
import { useConfirm } from '../../hooks/use-confirm';
import { useNotify } from '../../hooks/use-notify';

/**
 * Settings → Privacy: the PDF passwords this computer remembers (D336).
 * Each is shown by who or what it's for and how often it has opened a
 * statement, never itself. Add one ahead of an upload, or forget one.
 */
export function PdfPasswords() {
  const list = useApi('pdf-passwords', () => api.pdfPasswords.list(), { tags: ['pdf-passwords'] });
  const confirm = useConfirm();
  const notify = useNotify();
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = list.data ?? [];

  const add = async (e) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      await api.pdfPasswords.add(password, label.trim() || null);
      setPassword(''); setLabel(''); setAdding(false);
      invalidate('pdf-passwords');
      notify('Statements it opens will open by themselves', { name: 'password.saved' });
    } catch (err) {
      notify(err.message, { name: 'error.save' });
    } finally {
      setBusy(false);
    }
  };
  const forget = async (row) => {
    if (!(await confirm({ title: 'Forget this password?', message: 'Statements it opened will ask for it again.', confirm: 'Forget', destructive: true }))) return;
    await api.pdfPasswords.forget(row.id);
    invalidate('pdf-passwords');
  };

  const field = 'h-9 min-w-0 rounded-lg bg-band px-3 text-[14px] text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-info';
  return (
    <section className="apple-pane mt-8 max-w-2xl">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-medium text-ink">PDF passwords</h4>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="text-[13px] font-medium text-info">Add a password</button>}
      </div>
      <p className="mb-3 text-[13px] text-muted">
        A password that opens a statement is remembered on this computer, encrypted, and tried on the next locked one, so it opens by itself and its real pages show.
      </p>
      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-rule p-3">
          <input type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="PDF password" className={`${field} flex-1`} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Who it's for (optional)" aria-label="Who it's for" maxLength={60} className={`${field} flex-1`} />
          <button type="submit" disabled={!password || busy} className="h-9 rounded-lg bg-ink px-3 text-[13px] font-medium text-paper disabled:opacity-40">Remember</button>
          <button type="button" onClick={() => { setAdding(false); setPassword(''); setLabel(''); }} className="h-9 rounded-lg px-3 text-[13px] text-muted hover:text-ink">Cancel</button>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-4 py-3 text-[13px] text-muted">None yet. The next password you type to open a statement is kept here.</p>
      ) : (
        <ul className="divide-y divide-rule rounded-xl border border-rule">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-band text-muted" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{row.label ?? 'A statement password'}<span className="ml-2 font-mono text-muted">••••••••</span></span>
                <span className="block text-[12px] text-muted tnum">
                  {row.uses === 0 ? 'Not used for an upload yet' : `Opened ${row.uses} upload${row.uses === 1 ? '' : 's'}`}{row.last_used_at ? ` · last ${formatTimestamp(row.last_used_at)}` : ''}
                </span>
              </span>
              <button type="button" onClick={() => forget(row)} className="shrink-0 text-[13px] text-spend">Forget</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
