import { useNotify } from '../../../hooks/use-notify';
import { useToastLook } from '../../../hooks/use-toast-look';
import { TOAST_POSITIONS, TOAST_STYLES } from '../../../lib/app/toast-look';
import { toastName } from '../../../lib/app/toast-names';
import { cardLook } from '../../../lib/app/toast-surface';
import { ToastFace } from '../../ui/ToastFace';
import { GroupBlock } from '../apple/grouped';

const DESIGN_LABEL = { classic: 'Classic', glass: 'Glass', vivid: 'Vivid' };

/** A small screen with the sidebar, and a toast where this place puts it. */
function PlaceThumb({ place }) {
  const top = place.startsWith('top'), right = place.endsWith('right');
  const x = right ? 68 : 46, y = top ? 8 : 52;
  return (
    <svg width="104" height="68" viewBox="0 0 104 68" aria-hidden="true" className="block">
      <rect width="104" height="68" rx="8" fill="var(--color-band)" />
      <rect width="24" height="68" rx="8" fill="var(--color-rule)" opacity="0.6" />
      <rect x="32" y={top ? 22 : 10} width="64" height="8" rx="3" fill="var(--color-rule)" />
      <rect x="32" y={top ? 34 : 22} width="44" height="8" rx="3" fill="var(--color-rule)" />
      <rect x={x} y={y} width="30" height="9" rx="4.5" fill="var(--color-info)" />
    </svg>
  );
}

/**
 * Settings → Notifications' look and place (D387): the design in use's own
 * looks, each drawn as it shows, and four places. Each design keeps its own,
 * so switching design brings back that design's choice. Choosing raises a
 * sample, so the motion and the place are seen at once.
 */
export function ToastLook({ design, saved }) {
  const notify = useNotify();
  const { style, position, ready, change } = useToastLook(design);
  if (!ready) return null;
  const sample = () => notify('Freedom Unlimited ···1234', { name: 'account.closed', action: { label: 'Undo', onClick: () => {} } });
  // The sample waits for the save, so the toasts have the new look when it shows.
  const pick = (update) => change(update).then(sample);
  const preview = { type: 'success', title: toastName('account.closed', saved, design), message: 'Freedom ···1234', emoji: '🔒', action: { label: 'Undo' }, duration: 0 };
  const styles = TOAST_STYLES[design] ?? TOAST_STYLES.classic;

  return (
    <div className="mb-10 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
      <GroupBlock
        header={`${DESIGN_LABEL[design]}’s look`}
        footer={styles.length > 1 ? `These are ${DESIGN_LABEL[design]}’s own; each design keeps its own look. Choosing one shows it.` : 'Classic has one look, quiet like the rest of Classic. Glass and Vivid each have three.'}
      >
        <div role="radiogroup" aria-label="Toast look">
          {styles.map((s) => {
            const on = s.key === style;
            const card = cardLook(s.key, preview);
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick({ style: s.key })}
                className="group/look flex w-full flex-col gap-3 border-t border-rule px-4 py-3.5 text-left transition-colors first:border-t-0 hover:bg-band sm:flex-row sm:items-center"
              >
                <span className={`pointer-events-none block w-full shrink-0 rounded-2xl bg-band p-2.5 sm:w-[19rem] ${on ? 'ring-2 ring-info' : ''}`} aria-hidden="true">
                  <span className={`block overflow-hidden ${card.className}`} style={card.style} inert>
                    <ToastFace toast={preview} look={s.key} still preview />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className={`text-[15px] ${on ? 'font-semibold text-ink' : 'text-ink'}`}>{s.label}</span>
                    {on && <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true"><path d="M2.5 8l3.2 3.2L12.5 4" fill="none" stroke="var(--color-info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted">{s.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </GroupBlock>

      <GroupBlock header="Where they show" footer="On a phone the right-hand places use the centre; the bottom ones sit above the assistant’s buttons.">
        <div role="radiogroup" aria-label="Where toasts show" className="grid grid-cols-2 gap-x-2 gap-y-4 px-3 py-4">
          {TOAST_POSITIONS.map((p) => {
            const on = p.key === position;
            return (
              <button key={p.key} type="button" role="radio" aria-checked={on} onClick={() => pick({ position: p.key })} className="flex flex-col items-center gap-2">
                <span className={`block rounded-[11px] p-[3px] transition-shadow ${on ? 'shadow-[0_0_0_3px_var(--color-info)]' : 'shadow-[0_0_0_1px_var(--color-rule)]'}`}>
                  <PlaceThumb place={p.key} />
                </span>
                <span className={`text-[13px] ${on ? 'font-semibold text-ink' : 'text-muted'}`}>{p.label}</span>
              </button>
            );
          })}
        </div>
      </GroupBlock>
    </div>
  );
}
