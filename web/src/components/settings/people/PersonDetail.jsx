import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, formatMoney, maskName } from '../../../api';
import { FAMILY_AVATARS } from '../../../lib/app/avatars';
import { PersonAvatar } from '../../ui/PersonAvatar';
import { GroupBlock, GroupRow, RowChevron } from '../apple/grouped';
import { MiniCard } from '../apple/SplitList';
import { Tilt, CountUp, Rise, GrowBar } from './motion-bits';
import { AddressHistory } from './AddressHistory';
import { monthYear, accountWord } from './person-format';
import { Loading } from '../../ui/Loading';

/**
 * One person (D302), as the household's statements describe them: the names
 * those statements print, the addresses they're mailed to, the accounts
 * behind them and how far back each goes, and the year's money. Edit turns
 * the name (in the title), the nickname and, outside Classic, the avatar into
 * fields where they sit (Classic shows initials, not emoji); everything else
 * comes from statements and is shown, not edited. Add is the same screen,
 * empty. Names and addresses are masked in privacy mode.
 */

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16 } };
const FIELD = 'w-full min-w-0 bg-transparent text-right text-ink outline-none placeholder:text-faint';

function Actions({ editing, adding, saving, canSave, onEdit, onCancel, still }) {
  const pill = 'rounded-full px-3.5 py-1 text-[15px] transition-[background-color,filter,opacity] duration-150';
  const body = editing ? (
    <>
      <button type="button" onClick={onCancel} disabled={saving} className={`${pill} text-info hover:bg-info/10 active:bg-info/15`}>Cancel</button>
      <button type="submit" disabled={saving || !canSave} className={`${pill} bg-info font-semibold text-white hover:brightness-110 active:brightness-95 disabled:opacity-40`}>
        {saving ? (adding ? 'Adding…' : 'Saving…') : adding ? 'Add' : 'Done'}
      </button>
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

export function PersonDetail({ person = null, profile, mode, design, still, onEdit, onCancel, onSaved, onDirty }) {
  const adding = mode === 'add';
  const editing = mode !== 'view';
  const glyphs = design !== 'classic';

  const sessionKey = editing ? `${mode}:${person?.id ?? 'new'}` : null;
  const [s, setS] = useState({ key: null, before: null, form: null, saving: false, error: null });
  if (s.key !== sessionKey) {
    const base = !editing ? null : { name: person?.name ?? '', nickname: person?.nickname ?? '', avatar: person?.avatar ?? '' };
    setS({ key: sessionKey, before: base, form: base, saving: false, error: null });
  }
  const form = s.form;
  const dirty = editing && Boolean(form) && JSON.stringify(form) !== JSON.stringify(s.before);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  if (editing && !form) return null;
  const set = (key) => (value) => setS((x) => ({ ...x, form: { ...x.form, [key]: value } }));

  async function submit(e) {
    e.preventDefault();
    if (!editing) return;
    const name = form.name.trim().replace(/\s+/g, ' ');
    if (!name) return setS((x) => ({ ...x, error: 'Give them a name' }));
    if (!adding && !dirty) return onCancel();
    setS((x) => ({ ...x, saving: true, error: null }));
    try {
      // The API has one audited route per field; only what changed is sent.
      const target = adding ? await api.personCreate(name) : person;
      if (!adding && name !== s.before.name.trim()) await api.personRename(target.id, name);
      if (form.nickname.trim() !== (adding ? '' : s.before.nickname.trim())) await api.personNickname(target.id, form.nickname.trim() || null);
      if (form.avatar !== (adding ? '' : s.before.avatar)) await api.personAvatar(target.id, form.avatar || null);
      onSaved({ ...target, name }, !adding);
    } catch (err) {
      setS((x) => ({ ...x, saving: false, error: err.message }));
    }
  }

  const shown = editing ? { ...person, name: form.name || 'New person', nickname: form.nickname, avatar: form.avatar || null } : person;
  const p = profile;
  const top = p?.top_categories ?? [];
  const open = p?.accounts.filter((a) => a.is_active) ?? [];
  const topMax = Math.max(1, ...top.map((c) => Math.abs(c.spent_cents)));

  return (
    <form onSubmit={submit} onKeyDown={(e) => editing && e.key === 'Escape' && onCancel()} noValidate>
      <header className="mb-7 flex flex-wrap items-center gap-x-5 gap-y-4">
        <div className="order-first flex w-full justify-end sm:order-2 sm:w-auto sm:self-start">
          <Actions editing={editing} adding={adding} saving={s.saving} canSave={!adding || Boolean(form.name.trim())} onEdit={onEdit} onCancel={() => onCancel()} still={still} />
        </div>
        <Tilt still={still} max={8} className="rounded-full">
          <span className="block rounded-full shadow-[0_10px_28px_-12px_rgb(0_0_0/0.45)]">
            <PersonAvatar person={shown ?? { name: '?' }} size={88} />
          </span>
        </Tilt>
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              rows={1}
              value={form.name}
              onChange={(e) => set('name')(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }}
              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
              autoFocus
              placeholder="Name"
              aria-label="Name"
              autoComplete="off"
              className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-lg bg-band px-2 py-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words text-ink outline-none placeholder:text-faint"
            />
          ) : (
            <h3 className="-mx-2 line-clamp-2 rounded-lg px-2 py-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words text-ink">{maskName(person.name)}</h3>
          )}
          {!editing && person.nickname && <p className="mt-0.5 text-[15px] text-muted">“{person.nickname}”</p>}
          {p && !editing && (
            <p className="mt-1 text-[13px] text-muted tnum">
              {open.length} {open.length === 1 ? 'account' : 'accounts'}{open.length < p.accounts.length ? ` (${p.accounts.length - open.length} closed)` : ''} · {p.statements.count.toLocaleString()} statements
              {p.statements.first && <> · since {monthYear(p.statements.first)}</>}
            </p>
          )}
        </div>
        {s.error && <p role="alert" className="order-last w-full text-[13px] text-spend">{s.error}</p>}
      </header>

      <div className="space-y-7">
        {editing && (
          <Rise still={still}>
            <GroupBlock header="About" footer={glyphs ? 'The avatar shows across the app. Classic shows initials.' : null}>
              <GroupRow label="Nickname" as="label" htmlFor="person-nickname" className="focus-within:bg-band">
                <input id="person-nickname" value={form.nickname} onChange={(e) => set('nickname')(e.target.value)} placeholder="Not set" autoComplete="off" className={FIELD} />
              </GroupRow>
              {glyphs && (
                <div className="flex gap-1.5 overflow-x-auto border-t border-rule px-4 py-2.5" role="radiogroup" aria-label="Avatar">
                  {FAMILY_AVATARS.map((a) => (
                    <button key={a} type="button" role="radio" aria-checked={form.avatar === a} onClick={() => set('avatar')(form.avatar === a ? '' : a)}
                      className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xl transition-transform duration-150 hover:scale-110 active:scale-95 ${form.avatar === a ? 'bg-info/15 ring-2 ring-info' : 'bg-band'}`}>
                      {a}
                    </button>
                  ))}
                </div>
              )}
            </GroupBlock>
          </Rise>
        )}

        {adding && <p className="px-4 text-[13px] text-muted">Their accounts are added under Accounts; statements then fill this page.</p>}

        {/* Read off statements, so not editable: it stays where it is and fades while editing. */}
        {!adding && p && (
          <div inert={editing} className={`space-y-7 transition-opacity duration-200 ${editing ? 'opacity-40' : ''}`}>
            <Rise still={still} index={0}>
              <GroupBlock header="On Statements" footer="How each statement prints their name. A new statement is matched to its owner by these.">
                {p.printed_names.length === 0 && <GroupRow label={<span className="text-faint">No statement has printed a name yet</span>} />}
                {p.printed_names.map((n) => (
                  <GroupRow key={n.name} label={<span className="font-mono text-[13px] tracking-wide">{maskName(n.name)}</span>}>
                    <span className="truncate text-[13px]" title={accountWord(n.accounts)}>{n.accounts.length} {n.accounts.length === 1 ? 'account' : 'accounts'}</span>
                  </GroupRow>
                ))}
              </GroupBlock>
            </Rise>

            <Rise still={still} index={1}>
              <AddressHistory address={p.address} still={still} />
            </Rise>

            <Rise still={still} index={2}>
              <GroupBlock header="Accounts">
                {p.accounts.map((a) => (
                  <Link key={a.id} to={`/settings?tab=accounts&account=${a.id}`} className="block transition-colors hover:bg-band active:bg-band">
                    <GroupRow label={<span className="flex items-center gap-3"><MiniCard account={a} /><span className={a.is_active ? 'text-ink' : 'text-muted'}>{a.name}</span>{a.mask && <span className="text-[13px] text-faint tnum">··{a.mask}</span>}</span>}>
                      <span className="text-[13px] tnum">{a.statements ? `${a.statements} · since ${monthYear(a.first_statement)}` : 'No statements'}{a.is_active ? '' : ' · Closed'}</span>
                      <RowChevron />
                    </GroupRow>
                  </Link>
                ))}
              </GroupBlock>
            </Rise>

            <Rise still={still} index={3}>
              <GroupBlock header={`${p.year} So Far`} footer={`Across their accounts, by the Overview's rules. ${p.money.transactions.toLocaleString()} transactions.`}>
                <GroupRow label="Spent"><CountUp cents={Math.abs(p.money.spent_cents)} still={still} className="text-ink" /></GroupRow>
                <GroupRow label="Salary"><CountUp cents={p.money.salary_cents} still={still} className="text-earn" /></GroupRow>
                <GroupRow label="All money in"><CountUp cents={p.money.deposits_cents} still={still} className="text-ink" /></GroupRow>
                {top.length > 0 && (
                  <div className="border-t border-rule px-4 py-3">
                    <p className="mb-2 text-[13px] text-muted">Where it went</p>
                    <ul className="space-y-2">
                      {top.map((c) => (
                        <li key={c.category} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                          <span className="truncate text-ink">{c.category}</span>
                          <span className="h-1.5 rounded-full bg-band"><GrowBar share={Math.abs(c.spent_cents) / topMax} still={still} className="block h-1.5 rounded-full bg-spend/70" /></span>
                          <span className="text-muted tnum">{formatMoney(Math.abs(c.spent_cents))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </GroupBlock>
            </Rise>

            {p.loans.length > 0 && (
              <Rise still={still} index={4}>
                <GroupBlock header="Loans" footer="Paid from, or carried on, their accounts.">
                  {p.loans.map((l) => (
                    <Link key={l.id} to={`/settings?tab=loans&loan=${l.id}`} className="block transition-colors hover:bg-band active:bg-band">
                      <GroupRow label={l.name}><span className="truncate">{l.lender}</span><RowChevron /></GroupRow>
                    </Link>
                  ))}
                </GroupBlock>
              </Rise>
            )}
          </div>
        )}
        {!adding && !p && <Loading />}
      </div>
    </form>
  );
}
