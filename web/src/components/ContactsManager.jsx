import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { MerchantAvatar } from './MerchantAvatar';

/**
 * Every contact the app has ever seen a Zelle payment from or to —
 * opened from the Contacts icon on the Zelle review page. Nobody adds
 * a contact by hand here: one arrives the moment a new name is used
 * reviewing a Zelle transaction (see routes/zelle.js's find-or-create),
 * or from the one-time backfill of names already reviewed before this
 * feature existed (db/015_contacts.sql). This page only edits what's
 * already there — a photo, a name, a nickname — and because every
 * display (this page, the review list above it, Income's Other Income
 * cards, Transactions, Cards) reads a contact live through
 * `contact_id`, an edit here shows up everywhere immediately, with no
 * transaction ever rewritten.
 *
 * Second modal layer over ZelleReview's own (z-30, same as
 * PersonDetail) — same shell, same stop-propagation-on-backdrop fix.
 */

function ContactRow({ contact, onChanged }) {
  const [name, setName] = useState(contact.name);
  const [nickname, setNickname] = useState(contact.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  async function saveField(field, value) {
    const trimmed = value.trim();
    if (field === 'name' && trimmed === contact.name) return;
    if (field === 'nickname' && trimmed === (contact.nickname ?? '')) return;
    if (field === 'name' && !trimmed) { setName(contact.name); return; } // name can't be cleared

    setBusy(true);
    setError(null);
    try {
      await api.contacts.update(contact.id, { [field]: trimmed || null });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.contacts.uploadImage(contact.id, file);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function removePhoto() {
    setBusy(true);
    setError(null);
    try {
      await api.contacts.removeImage(contact.id);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`flex items-center gap-3 py-2.5 ${busy ? 'opacity-50' : ''}`}>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <MerchantAvatar contact={contact} size={36} clickable onClick={() => fileRef.current?.click()} />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadPhoto} className="hidden" />
        {contact.image_path && (
          <button onClick={removePhoto} className="text-[10px] text-faint underline-offset-2 hover:text-spend hover:underline">
            Remove
          </button>
        )}
      </div>

      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => saveField('name', name)}
          placeholder="Name"
          className="w-full rounded-md border border-rule bg-raised px-2 py-1 text-sm text-ink focus:border-earn focus:outline-none"
        />
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onBlur={() => saveField('nickname', nickname)}
          placeholder="Nickname (optional)"
          className="w-full rounded-md border border-rule bg-raised px-2 py-1 text-sm text-ink focus:border-earn focus:outline-none"
        />
      </div>

      <div className="shrink-0 text-xs text-faint">seen {contact.transaction_count}×</div>
      {error && <div className="shrink-0 text-xs text-spend">{error}</div>}
    </li>
  );
}

export function ContactsManager({ onClose, onChanged }) {
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.contacts.list().then(setContacts).catch((err) => setError(err.message));

  useEffect(() => { load(); }, []);

  function handleRowChanged() {
    load();
    onChanged?.();
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-rule bg-raised p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-medium text-ink">Contacts</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">✕</button>
        </div>
        <p className="mb-4 text-sm text-muted">
          Everyone a Zelle transaction has ever named. Click a photo to change it — a rename or a new photo shows up
          everywhere this person appears.
        </p>

        {error && <p className="mb-3 text-sm text-spend">{error}</p>}

        {contacts === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-faint">No contacts yet — review a Zelle transaction to add the first one.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {contacts.map((c) => <ContactRow key={c.id} contact={c} onChanged={handleRowChanged} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
