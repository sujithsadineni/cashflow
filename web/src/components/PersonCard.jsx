import { api, maskName } from '../api';
import { PersonAvatar, AvatarPicker } from './ui/PersonAvatar';
import { useDesign } from '../design-context';
import { EditableText } from './Form';
import { CardFace } from './CardCarousel';
import { useNotify } from '../notification-context';

/**
 * The expanded view behind a person's avatar in Settings > People —
 * name (editable) plus every account/card already attributed to them
 * (`account.person_id`), reusing the same card face the wallet
 * carousel draws rather than inventing a second "what does a card
 * look like" design. Nothing here is new data: it's all things the
 * app already knows, just not previously shown in one place.
 */
export function PersonCard({ person, accounts, onClose, onRenamed }) {
  const notify = useNotify();
  const myAccounts = accounts.filter((a) => a.person_id === person.id);

  const vivid = useDesign().design === 'vivid';

  const setAvatar = async (avatar) => {
    await api.personAvatar(person.id, avatar);
    onRenamed();
  };

  const rename = async (name) => {
    await api.personRename(person.id, name);
    onRenamed();
    notify('Name updated', { type: 'success' });
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-rule bg-raised p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PersonAvatar person={person} size={56} />
            <EditableText value={person.name} onSave={rename} className="block text-xl font-medium" />
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">
            ✕
          </button>
        </div>

        {vivid && (
          <div className="mb-6">
            <div className="mb-2 text-sm font-medium text-muted">Avatar</div>
            <AvatarPicker value={person.avatar} onPick={setAvatar} />
          </div>
        )}

        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-faint">
          Cards & accounts
        </div>
        {myAccounts.length === 0 ? (
          <p className="text-sm text-muted">No accounts attributed to {maskName(person.name)} yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {myAccounts.map((account) => (
              <CardFace key={account.id} account={account} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
