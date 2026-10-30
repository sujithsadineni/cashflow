import { useState } from 'react';
import { useNotify } from '../../../hooks/use-notify';
import { MAX_NAME, TOASTS, TOAST_GROUPS, defaultName, toastName } from '../../../lib/app/toast-names';
import { ToastFace } from '../../ui/ToastFace';
import { cardLook } from '../../../lib/app/toast-surface';
import { useToastLook } from '../../../hooks/use-toast-look';
import { GroupBlock, GroupButton, GroupRow } from '../apple/grouped';

const FIELD = 'w-full min-w-0 bg-transparent text-right text-ink outline-none placeholder:text-faint';
const KIND = { success: 'Done', error: 'Problem', info: 'Note' };
const DESIGN_LABEL = { classic: 'Classic', glass: 'Glass', vivid: 'Vivid' };

/**
 * One toast in Settings → Notifications (D384): how it looks, with its
 * current name and a sample of the line under it; the name, which saves on
 * Enter or when the field is left (a blank or the app's own name puts the
 * app's name back); and what it is. Show It raises the real toast.
 */
export function ToastDetail({ toastKey, saved, design, onRename }) {
  const notify = useNotify();
  const { style: look } = useToastLook(design);
  const def = TOASTS[toastKey];
  const own = defaultName(toastKey, design);
  const current = toastName(toastKey, saved, design);
  const renamed = current !== own;
  // The field follows the saved name (an Undo elsewhere changes it) unless it's being typed in.
  const [draft, setDraft] = useState({ for: current, text: current });
  if (draft.for !== current) setDraft({ for: current, text: current });
  const group = TOAST_GROUPS.find((g) => g.key === def.group);
  const commit = () => { if (draft.text.trim() !== current) onRename(toastKey, draft.text); };
  const sample = { type: def.type, title: draft.text.trim() || own, message: def.example, emoji: def.emoji, action: def.action ? { label: def.action } : null, duration: 0 };
  const card = cardLook(look, sample);
  const id = `toast-name-${toastKey.replace(/\W/g, '-')}`;

  return (
    <div className="space-y-6">
      <header>
        <h3 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{current}</h3>
        <p className="mt-0.5 text-[13px] text-muted">{group.label} · {def.where}</p>
      </header>

      <GroupBlock header="How it looks" footer="The name is the bold line. The line under it says which thing, so it changes each time.">
        <div className="flex justify-center bg-band px-4 py-6">
          <div className={`w-full max-w-[26rem] overflow-hidden ${card.className}`} style={card.style}>
            <ToastFace toast={sample} look={look} still preview />
          </div>
        </div>
        <GroupButton onClick={() => notify(def.example, { name: toastKey, action: def.action ? { label: def.action, onClick: () => {} } : null })}>
          Show It
        </GroupButton>
      </GroupBlock>

      <GroupBlock
        header="Name"
        footer={renamed ? `The app calls it “${own}” in ${DESIGN_LABEL[design]}.` : `What happened, in ${DESIGN_LABEL[design]}’s words; at most ${MAX_NAME} letters. Each design keeps its own names.`}
      >
        <GroupRow label="Name" as="label" htmlFor={id}>
          <input
            id={id}
            value={draft.text}
            maxLength={MAX_NAME}
            autoComplete="off"
            placeholder={own}
            onChange={(e) => setDraft({ for: current, text: e.target.value })}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === 'Escape') { setDraft({ for: current, text: current }); }
            }}
            className={FIELD}
          />
        </GroupRow>
        {renamed && <GroupButton onClick={() => onRename(toastKey, '')}>Use the App’s Name</GroupButton>}
      </GroupBlock>

      <GroupBlock header="About">
        <GroupRow label="Kind">{KIND[def.type]}</GroupRow>
        <GroupRow label="Shows on"><span className="truncate">{def.where}</span></GroupRow>
        <GroupRow label="Button">{def.action ?? 'None'}</GroupRow>
      </GroupBlock>
    </div>
  );
}
