import { useEffect, useState } from 'react';
import { api, formatMoney, formatShortDate } from '../api';
import { Segmented } from './Form';
import { MerchantAvatar } from './MerchantAvatar';
import { ContactsManager } from './ContactsManager';
import { DetailDialog, ShowMore } from './ui/DetailDialog';

/**
 * Every Zelle transaction looks the same to the parser whether it's a
 * transfer between the household's own accounts or a real payment to
 * someone else — this is the review that tells them apart, by hand,
 * one row at a time. Lives inline on Overview's Zelle card (no
 * separate page, per direct instruction), same modal shell
 * SecondaryDetail.jsx uses elsewhere on this page.
 *
 * Each row assigns a name (pre-filled with a regex-suggested guess —
 * see api/src/zelle.js — never trusted as fact) and a type:
 * INTERNAL/SENT/RECEIVED. The type is what actually matters
 * financially: routes/zelle.js turns it into a real txn_type change
 * on save, which is what makes Sent count as Spend and Received count
 * as Income (Internal counts as neither) — nothing computed here.
 * Saves per row, on change, not a batch confirm — there's no
 * intermediate "staged" state to hold, unlike an import.
 *
 * Sent/Received are colored at their real meaning (spend/earn); Internal
 * uses the existing `warn` status token as a third, distinct color —
 * not a new accent, the design system already reserves it for exactly
 * this kind of "flagged, neither in nor out" state.
 */


const TYPE_OPTIONS = [
  { value: 'INTERNAL', label: 'Internal', tone: 'warn' },
  { value: 'SENT', label: 'Sent', tone: 'spend' },
  { value: 'RECEIVED', label: 'Received', tone: 'earn' },
];

const AMOUNT_TEXT_TONE = { INTERNAL: 'text-warn', SENT: 'text-spend', RECEIVED: 'text-earn' };

/** The row's linked contact, in the shape MerchantAvatar expects — null until reviewed. */
const contactOf = (txn) => (txn.contact_id ? { id: txn.contact_id, name: txn.contact_name, nickname: txn.contact_nickname, image_path: txn.contact_image_path } : null);

function ZelleRow({ txn, onSaved, onSelectPerson }) {
  const [name, setName] = useState(txn.zelle_person ?? txn.suggested_person);
  const [type, setType] = useState(txn.zelle_type ?? (txn.suggested_internal ? 'INTERNAL' : null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(nextType, nextName) {
    const t = nextType ?? type;
    const n = (nextName ?? name).trim();
    if (!t || !n) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.zelle.review(txn.id, { zelle_type: t, zelle_person: n });
      onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <MerchantAvatar
        contact={contactOf(txn)}
        description={txn.description}
        size={28}
        clickable={Boolean(name)}
        onClick={() => onSelectPerson({ contactId: txn.contact_id, name })}
      />

      <div className="min-w-0 flex-1">
        <input
          list="zelle-people"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => save(undefined, undefined)}
          placeholder="Who is this?"
          className="w-full rounded-md border border-rule bg-raised px-2 py-1 text-sm text-ink focus:border-earn focus:outline-none"
        />
        <div className="mt-0.5 truncate text-xs text-faint">{formatShortDate(txn.posted_date)} · {txn.description}</div>
        {error && <div className="mt-0.5 text-xs text-spend">{error}</div>}
      </div>

      <div className={`shrink-0 font-mono text-sm tnum ${type ? AMOUNT_TEXT_TONE[type] : 'text-ink'}`}>
        {formatMoney(txn.amount_cents)}
      </div>

      <div className={`shrink-0 ${saving ? 'opacity-50' : ''}`}>
        <Segmented value={type ?? ''} onChange={(v) => { setType(v); save(v, undefined); }} options={TYPE_OPTIONS} />
      </div>
    </li>
  );
}

/**
 * "How much have we transacted with this person" — opened by clicking
 * their avatar, from either section (a row doesn't need to be
 * reviewed yet to peek at their history, which can itself help decide
 * how to classify it). Totals only count already-reviewed rows —
 * financial facts, same rule as everywhere else here.
 */
function PersonDetail({ contactId, name, rows, onClose }) {
  // Group by the real contact once one exists (correct even across a
  // rename, or when the same person was typed slightly differently
  // before contacts existed) — an unreviewed row has no contact_id
  // yet, so it only shows up here via a matching suggested name, as a
  // preview of what confirming it would add.
  const withPerson = rows.filter((r) =>
    (contactId && r.contact_id === contactId) || (!r.contact_id && (r.zelle_person ?? r.suggested_person) === name)
  );
  const reviewed = withPerson.filter((r) => r.zelle_type);
  const contact = withPerson.find((r) => r.contact_id === contactId);

  const sentCents = reviewed.filter((r) => r.zelle_type === 'SENT').reduce((sum, r) => sum + r.amount_cents, 0);
  const receivedCents = reviewed.filter((r) => r.zelle_type === 'RECEIVED').reduce((sum, r) => sum + r.amount_cents, 0);
  const netCents = sentCents + receivedCents;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-rule bg-raised p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MerchantAvatar contact={contact ? contactOf(contact) : null} size={32} />
            <h3 className="text-base font-medium text-ink">{contact ? (contact.contact_nickname || contact.contact_name) : name}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">✕</button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xs text-muted">Sent</div>
            <div className="font-mono text-sm tnum text-spend">{formatMoney(sentCents)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Received</div>
            <div className="font-mono text-sm tnum text-earn">{formatMoney(receivedCents)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Net</div>
            <div className={`font-mono text-sm tnum ${netCents < 0 ? 'text-spend' : netCents > 0 ? 'text-earn' : 'text-ink'}`}>
              {formatMoney(netCents)}
            </div>
          </div>
        </div>

        {withPerson.length === 0 ? (
          <p className="text-sm text-muted">No other transactions with this name.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {withPerson.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="tnum text-muted">{formatShortDate(t.posted_date)}</span>
                <span className={`font-mono tnum ${t.zelle_type ? AMOUNT_TEXT_TONE[t.zelle_type] : 'text-faint'}`}>
                  {formatMoney(t.amount_cents)}
                  {!t.zelle_type && <span className="ml-1.5 text-xs text-faint">unreviewed</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ZelleReview({ onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [error, setError] = useState(null);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [showContacts, setShowContacts] = useState(false);
  const [search, setSearch] = useState('');

  const loadContacts = () => api.contacts.list().then(setContacts);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.zelle.list(), api.contacts.list()])
      .then(([r, c]) => { if (!cancelled) { setRows(r); setContacts(c); } })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  function handleSaved(updated) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    loadContacts(); // a new name may have just created a contact
    onChanged?.();
  }

  function handleContactsChanged() {
    loadContacts();
    api.zelle.list().then(setRows); // renamed/photographed contacts need to show in the rows above too
    onChanged?.();
  }

  const needsReview = (rows ?? []).filter((r) => !r.zelle_type);
  const reviewed = (rows ?? []).filter((r) => r.zelle_type);
  const q = search.trim().toLowerCase();
  const reviewedShown = q
    ? reviewed.filter((r) => `${r.contact_nickname ?? ''} ${r.contact_name ?? ''} ${r.zelle_person ?? ''} ${r.description}`.toLowerCase().includes(q))
    : reviewed;

  // Who money actually moves with — reviewed Sent/Received only (Internal
  // is the household moving its own money), grouped by contact.
  const byPerson = new Map();
  for (const r of reviewed) {
    if (r.zelle_type === 'INTERNAL') continue;
    const key = r.contact_id ?? r.zelle_person;
    const entry = byPerson.get(key) ?? { key, name: r.contact_nickname || r.contact_name || r.zelle_person, contactId: r.contact_id, sent: 0, received: 0, count: 0 };
    if (r.zelle_type === 'SENT') entry.sent += r.amount_cents;
    else entry.received += r.amount_cents;
    entry.count += 1;
    byPerson.set(key, entry);
  }
  const people = [...byPerson.values()].sort((a, b) => Math.abs(b.sent) + b.received - (Math.abs(a.sent) + a.received));
  const peopleMax = Math.max(1, ...people.map((p) => Math.max(Math.abs(p.sent), p.received)));
  const totalSent = reviewed.filter((r) => r.zelle_type === 'SENT').reduce((sum, r) => sum + r.amount_cents, 0);
  const totalReceived = reviewed.filter((r) => r.zelle_type === 'RECEIVED').reduce((sum, r) => sum + r.amount_cents, 0);

  const rowList = (list, limit) => (
    <ShowMore
      items={list}
      limit={limit}
      as="ul"
      className="divide-y divide-rule"
      render={(t) => <ZelleRow key={t.id} txn={t} onSaved={handleSaved} onSelectPerson={setSelectedPerson} />}
    />
  );

  const contactsButton = (
    <button onClick={() => setShowContacts(true)} title="Contacts" aria-label="Contacts" className="text-muted transition-colors hover:text-ink">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="6" cy="5.2" r="2.2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2 13c0-2.1 1.8-3.8 4-3.8s4 1.7 4 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="12" cy="4.5" r="1.7" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10.5 8.3c1.7.3 2.9 1.6 3.2 3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );

  return (
    <>
      <datalist id="zelle-people">
        {contacts.map((c) => <option key={c.id} value={c.name} />)}
      </datalist>

      <DetailDialog
        title="Zelle transfers"
        emoji="💸"
        tint="bg-vivid-pink/10"
        width="max-w-2xl"
        actions={contactsButton}
        hero={rows && { label: 'Sent, all time', value: formatMoney(totalSent), tone: 'spend' }}
        side={rows && { label: 'Received, all time', value: `+${formatMoney(totalReceived)}`, tone: 'earn' }}
        sections={
          rows === null
            ? [{ key: 'loading', label: 'Loading', content: error ? <p className="text-sm text-spend">{error}</p> : <p className="text-sm text-muted">Loading…</p> }]
            : [
                needsReview.length > 0 && { key: 'review', label: 'Needs review', count: needsReview.length, content: rowList(needsReview, 10) },
                {
                  key: 'reviewed',
                  label: 'Reviewed',
                  count: reviewed.length,
                  content: (
                    <>
                      <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search a name or description…"
                        aria-label="Search reviewed Zelle transfers"
                        className="mb-2 w-full rounded-lg border border-rule bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-earn focus:outline-none"
                      />
                      {reviewedShown.length === 0 ? <p className="text-sm text-faint">No matches.</p> : rowList(reviewedShown, 12)}
                    </>
                  ),
                },
                people.length > 0 && {
                  key: 'people',
                  label: 'People',
                  count: people.length,
                  content: (
                    <ShowMore
                      items={people}
                      limit={8}
                      className="flex flex-col gap-3"
                      render={(p) => (
                        <button
                          key={p.key}
                          onClick={() => setSelectedPerson({ contactId: p.contactId, name: p.name })}
                          className="rounded-lg p-1 text-left transition-colors hover:bg-band"
                        >
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="truncate text-ink">{p.name}</span>
                            <span className="shrink-0 text-xs text-faint">{p.count} transfer{p.count === 1 ? '' : 's'}</span>
                          </div>
                          <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5 text-xs">
                            {p.sent !== 0 && (
                              <>
                                <span className="h-1.5 rounded-full bg-band"><span className="block h-1.5 rounded-full bg-spend" style={{ width: `${(Math.abs(p.sent) / peopleMax) * 100}%` }} /></span>
                                <span className="font-mono tnum text-spend">{formatMoney(p.sent)}</span>
                              </>
                            )}
                            {p.received !== 0 && (
                              <>
                                <span className="h-1.5 rounded-full bg-band"><span className="block h-1.5 rounded-full bg-earn" style={{ width: `${(p.received / peopleMax) * 100}%` }} /></span>
                                <span className="font-mono tnum text-earn">+{formatMoney(p.received)}</span>
                              </>
                            )}
                          </div>
                        </button>
                      )}
                    />
                  ),
                },
              ]
        }
        note="Internal doesn't affect Income or Spent. Sent counts as Spend, Received counts as Income. Click a name to see everything you've transacted with them."
        onClose={onClose}
      />

      {selectedPerson && (
        <PersonDetail contactId={selectedPerson.contactId} name={selectedPerson.name} rows={rows ?? []} onClose={() => setSelectedPerson(null)} />
      )}
      {showContacts && <ContactsManager onClose={() => setShowContacts(false)} onChanged={handleContactsChanged} />}
    </>
  );
}
