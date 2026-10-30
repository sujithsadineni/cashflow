import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useApi } from '../../hooks/use-api';
import { useDesign } from '../../hooks/use-design';
import { AssistantPanel } from './AssistantPanel';
import { SparkIcon } from './SparkIcon';

/**
 * The assistant's button (D332), above the help button in the corner
 * stack (Layout). Opens the panel; Esc or a click anywhere else closes it
 * and gives focus back to the button. The spark rests while it's open.
 * A dot says an answer from Claude Code is waiting to be read (D332 step
 * 2); the list reloads when the window comes back into focus, since the
 * answer is written from outside the app.
 */
export function AssistantButton() {
  const vivid = useDesign().design === 'vivid';
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const { data, reload } = useApi('assistant:questions', () => api.assistant.questions(), { tags: ['assistant'] });
  const unseen = data?.unseen ?? 0;

  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onKey = (e) => e.key === 'Escape' && close();
    const onClick = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="apple-pane">
      {open && (
        <AssistantPanel
          questions={data?.questions ?? []}
          unseen={unseen}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close the assistant' : `Ask about your money${unseen > 0 ? ` (${unseen} new ${unseen === 1 ? 'answer' : 'answers'})` : ''}`}
        aria-expanded={open}
        className={`assistant-button relative flex size-11 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-[1.08] active:scale-[0.94] ${
          vivid ? 'bg-vivid-purple' : 'border border-rule-str bg-raised'
        }`}
      >
        <SparkIcon still={open} />
        {unseen > 0 && !open && <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full border-2 border-raised bg-info" aria-hidden="true" />}
      </button>
    </div>
  );
}
