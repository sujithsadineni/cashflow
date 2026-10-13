import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { api, formatMoney, maskName, shortPersonName } from '../../api';
import { useNotify } from '../../use-notify';
import { FAMILY_AVATARS } from '../../avatars';
import { initialsFor } from '../../merchant-logos';
import { accountArt, accountKind } from '../../account-art';
import { EditableText } from '../Form';

/**
 * Settings → People in the Glass design (D243), after Apple's Contact
 * Posters and Contacts card.
 *
 *   GlassPeople       a large poster card per person: their avatar big on a
 *                     colour field, nickname as the headline (full name
 *                     under it), the month's spending and salary, their
 *                     top categories, and their cards fanned at the foot
 *   GlassPersonSheet  the Contacts card: the poster as a header with an
 *                     avatar picker, editable name and nickname, the month
 *                     in numbers, where the money went, and every card
 *
 * Everything shown is read from data the app already has: the person, the
 * accounts they hold, the month's summary (by person, by person and
 * category) and their transaction count.
 */

// Each person's poster colours: Apple system pairs, picked by id so a person keeps theirs.
const POSTERS = [
  ['#5E5CE6', '#BF5AF2'],
  ['#FF375F', '#FF9F0A'],
  ['#30B0C7', '#34C759'],
  ['#0A84FF', '#64D2FF'],
  ['#AC8E68', '#FF9F0A'],
];
const posterOf = (person) => POSTERS[(person.id - 1) % POSTERS.length];
const settle = { type: 'spring', bounce: 0, duration: 0.6 };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (key) => MONTH_NAMES[Number(key.slice(5, 7)) - 1];
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** The month to describe: this one, or last month while this one has no statements yet. */
function useHouseholdMonth() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const thisKey = monthKey(now);
    const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    api.summary(thisKey)
      .then((s) => (s.by_person.some((p) => p.net_cents !== 0) ? [thisKey, s] : api.summary(lastKey).then((t) => [lastKey, t])))
      .then(([key, s]) => !cancelled && setState({ key, summary: s }))
      .catch(() => !cancelled && setState({ key: thisKey, summary: null }));
    return () => { cancelled = true; };
  }, []);
  return state;
}

function useTransactionCounts(people) {
  const [counts, setCounts] = useState({});
  const ids = people.map((p) => p.id).join(',');
  useEffect(() => {
    let cancelled = false;
    Promise.all(people.map((p) => api.transactions.list({ person_id: p.id, limit: 1 }).then((r) => [p.id, r.total]).catch(() => [p.id, null])))
      .then((pairs) => !cancelled && setCounts(Object.fromEntries(pairs)));
    return () => { cancelled = true; };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}

/** The person's avatar, large: their emoji on glass, else their initial. */
function Avatar({ person, size }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/25 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.45)] backdrop-blur-md"
      style={{ width: size, height: size, fontSize: size * 0.56 }}
      aria-hidden="true"
    >
      {person.avatar ?? <span className="font-semibold text-white" style={{ fontSize: size * 0.42 }}>{initialsFor(maskName(person.name))}</span>}
    </span>
  );
}

/** Up to four of their cards, fanned. */
function CardFan({ accounts }) {
  const shown = [...accounts].sort((a, b) => Number(Boolean(b.image_path)) - Number(Boolean(a.image_path))).slice(0, 4);
  if (shown.length === 0) return <p className="text-sm text-white/75">No accounts yet</p>;
  return (
    <div className="relative h-14 w-44" aria-hidden="true">
      {shown.map((a, i) => (
        <span
          key={a.id}
          className="absolute top-0 h-14 w-[5.5rem] overflow-hidden rounded-lg border border-white/30 shadow-lg"
          style={{ ...accountArt(a).style, left: i * 26, transform: `rotate(${(i - (shown.length - 1) / 2) * 5}deg)`, zIndex: i }}
        />
      ))}
    </div>
  );
}

function PosterCard({ person, accounts, month, monthKeyLabel, txCount, index, onOpen }) {
  const [from, to] = posterOf(person);
  const cards = accounts.filter((a) => a.account_type === 'CREDIT_CARD').length;
  const banks = accounts.length - cards;
  const spent = month?.spent;
  const salary = month?.salary;
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 18, scale: 0.98, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      transition={{ ...settle, delay: index * 0.08 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      className="relative flex min-h-[24rem] flex-col overflow-hidden rounded-[28px] p-6 text-left text-white shadow-[0_24px_60px_-28px_rgb(0_0_0/0.55)]"
      style={{ background: `linear-gradient(160deg, ${from} 0%, ${to} 100%)` }}
    >
      {/* Light on the poster: soft blooms and a sheen, like a Contact Poster. */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/25 blur-3xl" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-10 size-72 rounded-full bg-black/20 blur-3xl" />

      <div className="relative flex items-start justify-between">
        <Avatar person={person} size={92} />
        {txCount != null && (
          <span className="rounded-full bg-black/20 px-3 py-1 text-xs font-medium backdrop-blur-md tnum">{txCount.toLocaleString()} transactions</span>
        )}
      </div>

      <div className="relative mt-6">
        <p className="text-[2.6rem] font-bold leading-[1.02] tracking-[-0.035em]">{shortPersonName(person.name, person.nickname)}</p>
        <p className="mt-1 text-sm text-white/80">{maskName(person.name)}</p>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-black/20 px-3.5 py-2.5 backdrop-blur-md">
          <p className="text-[0.6875rem] text-white/75">Spent in {monthKeyLabel}</p>
          <p className="mt-0.5 text-lg font-semibold tracking-[-0.02em] tnum">{spent != null ? formatMoney(Math.abs(spent)) : '—'}</p>
        </div>
        <div className="rounded-2xl bg-black/20 px-3.5 py-2.5 backdrop-blur-md">
          <p className="text-[0.6875rem] text-white/75">{salary ? `Salary in ${monthKeyLabel}` : 'Accounts'}</p>
          <p className="mt-0.5 text-lg font-semibold tracking-[-0.02em] tnum">
            {salary ? formatMoney(salary) : `${cards} card${cards === 1 ? '' : 's'} · ${banks} bank`}
          </p>
        </div>
      </div>

      {month?.top?.length > 0 && (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {month.top.slice(0, 3).map((c) => (
            <span key={c.category_name} className="rounded-full bg-white/20 px-2.5 py-1 text-xs backdrop-blur-md">{c.category_name}</span>
          ))}
        </div>
      )}

      <div className="relative mt-auto flex items-end justify-between pt-6">
        <CardFan accounts={accounts} />
        <span className="text-sm font-medium text-white/85">Open ›</span>
      </div>
    </motion.button>
  );
}

function AddPersonCard({ onAdded }) {
  const notify = useNotify();
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      await api.personCreate(n);
      notify(`${n} added`, { type: 'success' });
      setName('');
      onAdded();
    } catch (err) {
      notify(err.message, { type: 'error', title: 'Couldn’t add them' });
    }
  };
  return (
    <form onSubmit={add} className="flex min-h-[24rem] flex-col items-center justify-center gap-4 rounded-[28px] border-2 border-dashed border-rule-str p-6 text-center">
      <span className="flex size-[5.75rem] items-center justify-center rounded-full bg-band text-4xl text-muted" aria-hidden="true">+</span>
      <p className="text-lg font-semibold text-ink">Add a person</p>
      <div className="flex w-full max-w-xs gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Their name"
          aria-label="Their name"
          className="min-w-0 flex-1 rounded-full border border-rule bg-raised px-4 py-2 text-ink outline-none placeholder:text-faint focus:border-info"
        />
        <button type="submit" disabled={!name.trim()} className="btn btn-primary rounded-full px-4 py-2 font-semibold disabled:opacity-50">Add</button>
      </div>
    </form>
  );
}

export function GlassPeople({ people, accounts, onChange }) {
  const household = useHouseholdMonth();
  const counts = useTransactionCounts(people);
  const [openId, setOpenId] = useState(null);

  const months = useMemo(() => {
    const s = household?.summary;
    if (!s) return {};
    return Object.fromEntries(people.map((p) => {
      const row = s.by_person.find((r) => r.id === p.id);
      const top = s.spend_by_person_category.filter((r) => r.person_id === p.id).sort((a, b) => a.spend_cents - b.spend_cents);
      return [p.id, { spent: row?.net_cents ?? null, salary: row?.salary_cents || 0, top }];
    }));
  }, [household, people]);

  const label = household ? monthName(household.key) : '';
  const accountsOf = (id) => accounts.filter((a) => a.person_id === id);
  const open = people.find((p) => p.id === openId) ?? null;

  return (
    <section>
      {/* The title and household line live in the Settings pane header now (D244). */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {people.map((p, i) => (
          <PosterCard
            key={p.id}
            person={p}
            accounts={accountsOf(p.id)}
            month={months[p.id]}
            monthKeyLabel={label}
            txCount={counts[p.id]}
            index={i}
            onOpen={() => setOpenId(p.id)}
          />
        ))}
        <AddPersonCard onAdded={onChange} />
      </div>
      {open && (
        <GlassPersonSheet
          person={open}
          accounts={accountsOf(open.id)}
          month={months[open.id]}
          monthKeyLabel={label}
          txCount={counts[open.id]}
          onClose={() => setOpenId(null)}
          onChanged={onChange}
        />
      )}
    </section>
  );
}

const Row = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-3 first:border-t-0">
    <span className="text-ink">{label}</span>
    <span className="min-w-0 text-right text-muted">{children}</span>
  </div>
);

export function GlassPersonSheet({ person, accounts, month, monthKeyLabel, txCount, onClose, onChanged }) {
  const notify = useNotify();
  const [from, to] = posterOf(person);
  const run = async (fn, done) => {
    try {
      await fn();
      onChanged();
      notify(done, { type: 'success' });
    } catch (err) {
      notify(err.message, { type: 'error', title: 'Couldn’t save that' });
    }
  };
  const top = month?.top ?? [];
  const topMax = Math.max(1, ...top.map((c) => Math.abs(c.spend_cents)));
  const credit = accounts.filter((a) => a.account_type === 'CREDIT_CARD');
  const banks = accounts.filter((a) => a.account_type !== 'CREDIT_CARD');

  return (
    <div className="modal-scrim fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={person.name}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto border border-rule bg-raised shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The poster, as the card's header. */}
        <div className="relative overflow-hidden px-6 pb-6 pt-5 text-white" style={{ background: `linear-gradient(160deg, ${from} 0%, ${to} 100%)` }}>
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-white/25 blur-3xl" />
          <div className="relative flex justify-end">
            <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-full bg-black/25 text-white/90 backdrop-blur-md">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
            </button>
          </div>
          <motion.div className="relative flex flex-col items-center text-center" initial={{ opacity: 0, scale: 0.95, filter: 'blur(8px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={settle}>
            <Avatar person={person} size={120} />
            <p className="mt-4 text-4xl font-bold tracking-[-0.035em]">{shortPersonName(person.name, person.nickname)}</p>
            <p className="mt-1 text-white/80">{maskName(person.name)}{txCount != null ? ` · ${txCount.toLocaleString()} transactions` : ''}</p>
          </motion.div>
          {/* Pick an avatar: the family set, large, on glass. */}
          <div className="relative mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {FAMILY_AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => run(() => api.personAvatar(person.id, a === person.avatar ? null : a), a === person.avatar ? 'Avatar cleared' : 'Avatar updated')}
                aria-label={`Use ${a} as the avatar`}
                aria-pressed={a === person.avatar}
                className={`flex size-11 shrink-0 items-center justify-center rounded-full text-2xl backdrop-blur-md transition-transform hover:scale-110 ${a === person.avatar ? 'bg-white/90 ring-2 ring-white' : 'bg-white/20'}`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6 p-5">
          {/* The month, in numbers. */}
          <div>
            <p className="mx-1 mb-1.5 text-sm text-muted">{monthKeyLabel}</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Spent', month?.spent != null ? formatMoney(Math.abs(month.spent)) : '—', 'text-spend'],
                ['Salary', month?.salary ? formatMoney(month.salary) : '—', 'text-earn'],
                ['Accounts', `${accounts.length}`, 'text-ink'],
              ].map(([l, v, tone]) => (
                <div key={l} className="rounded-2xl bg-band px-3.5 py-3">
                  <p className="text-xs text-muted">{l}</p>
                  <p className={`mt-0.5 text-xl font-semibold tracking-[-0.02em] tnum ${tone}`}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          {top.length > 0 && (
            <div>
              <p className="mx-1 mb-1.5 text-sm text-muted">Where it went in {monthKeyLabel}</p>
              <div className="space-y-2.5 rounded-2xl bg-band p-4">
                {top.slice(0, 5).map((c, i) => (
                  <div key={c.category_name}>
                    <div className="flex justify-between text-sm"><span className="text-ink">{c.category_name}</span><span className="text-muted tnum">{formatMoney(Math.abs(c.spend_cents))}</span></div>
                    <motion.div
                      className="mt-1 h-1.5 rounded-full"
                      style={{ background: `linear-gradient(90deg, ${from}, ${to})` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(Math.abs(c.spend_cents) / topMax) * 100}%` }}
                      transition={{ ...settle, delay: 0.1 + i * 0.05 }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {[['Cards', credit], ['Bank accounts', banks]].map(([title, list]) => list.length > 0 && (
            <div key={title}>
              <p className="mx-1 mb-1.5 text-sm text-muted">{title} · {list.length}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {list.map((a) => {
                  const art = accountArt(a);
                  return (
                    <div key={a.id} className="relative aspect-[1.586] overflow-hidden rounded-xl text-white shadow-md" style={art.style}>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                      {art.logo && <span className="absolute right-2 top-2 flex h-6 items-center rounded bg-white/95 px-1.5"><img src={art.logo} alt="" className="h-4 w-auto" /></span>}
                      {accountKind(a) && <span className="absolute left-2.5 top-2 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-white/85">{accountKind(a)}</span>}
                      <div className="absolute inset-x-2.5 bottom-2 flex items-end justify-between gap-2 text-xs">
                        <span className="truncate font-semibold drop-shadow">{a.name}</span>
                        {a.mask && <span className="shrink-0 tnum opacity-90">•• {a.mask}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <p className="mx-1 mb-1.5 text-sm text-muted">Details</p>
            <div className="overflow-hidden rounded-2xl bg-band">
              <Row label="Name"><EditableText value={person.name} onSave={(name) => run(() => api.personRename(person.id, name), 'Name updated')} className="text-ink" /></Row>
              <Row label="Nickname">
                <span className="inline-flex items-center gap-2">
                  <EditableText value={person.nickname ?? null} onSave={(n) => run(() => api.personNickname(person.id, n), `Nickname set to ${n}`)} placeholder={`Add one (else “${person.name.split(' ')[0]}”)`} className="text-ink" />
                  {person.nickname && <button onClick={() => run(() => api.personNickname(person.id, null), 'Nickname cleared')} className="text-xs text-info">Clear</button>}
                </span>
              </Row>
              <Row label="Shown as">{shortPersonName(person.name, person.nickname)}</Row>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
