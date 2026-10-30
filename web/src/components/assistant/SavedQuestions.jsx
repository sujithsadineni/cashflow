import { useState } from 'react';
import { api } from '../../api';
import { invalidate, useApi } from '../../hooks/use-api';
import { askedLabel, isNewAnswer } from '../../lib/assistant/questions';
import { AnswerView } from './AnswerView';
import { Loading } from '../ui/Loading';

/**
 * The panel's History view (D332): every question asked, newest first,
 * answered here or saved for Claude Code. Opening one shows its answer:
 * one answered here or by Claude is loaded in full (what it found isn't in
 * the list);
 * a new answer from Claude Code is marked seen. Dismiss hides a question
 * (kept, not deleted).
 */

const STATE = {
  waiting: 'Waiting for Claude Code',
  answered: 'Answered',
  not_understood: 'Not answered',
};
const VIA = { local: 'Here', claude_code: 'Claude Code', claude: 'Claude' };

function LocalAnswer({ id, onAsk }) {
  const { data, loading } = useApi(`assistant:question:${id}`, () => api.assistant.question(id));
  if (loading && !data) return <Loading />;
  return <AnswerView detail={data?.answer_detail} onAsk={onAsk} />;
}

export function SavedQuestions({ questions, highlight, onAsk }) {
  const [openId, setOpenId] = useState(highlight ?? null);
  const waiting = questions.filter((q) => q.status === 'waiting').length;

  const toggle = async (q) => {
    const opening = openId !== q.id;
    setOpenId(opening ? q.id : null);
    if (opening && isNewAnswer(q)) {
      await api.assistant.seen(q.id);
      invalidate('assistant');
    }
  };
  const dismiss = async (q) => {
    await api.assistant.dismiss(q.id);
    setOpenId(null);
    invalidate('assistant');
  };

  if (questions.length === 0) {
    return <p className="px-0.5 py-6 text-center text-[13px] text-muted">No questions yet. Ask one and choose Answer here, or save it for Claude Code.</p>;
  }
  return (
    <div className="grid gap-1.5">
      {waiting > 0 && (
        <p className="rounded-xl bg-band px-3 py-2 text-[12.5px] text-muted">
          {waiting === 1 ? '1 question is' : `${waiting} questions are`} waiting. Open Claude Code in this project and ask it to answer your saved questions.
        </p>
      )}
      <ul className="grid gap-0.5">
        {questions.map((q) => {
          const open = openId === q.id;
          return (
            <li key={q.id} className={`rounded-xl ${open ? 'bg-band' : ''}`}>
              <button type="button" onClick={() => toggle(q)} aria-expanded={open} className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-band">
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${isNewAnswer(q) ? 'bg-info' : 'bg-transparent'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] text-ink ${isNewAnswer(q) ? 'font-semibold' : ''}`}>{q.question}</span>
                  <span className="block text-[11.5px] text-faint">
                    {askedLabel(q.asked_at)} · {VIA[q.asked_via] ?? q.asked_via} · {isNewAnswer(q) ? 'New answer' : STATE[q.status] ?? q.status}
                  </span>
                </span>
              </button>
              {open && (
                <div className="grid min-w-0 grid-cols-1 gap-2 px-2.5 pb-2.5 pl-6">
                  {q.has_detail ? (
                    <LocalAnswer id={q.id} onAsk={onAsk} />
                  ) : q.status === 'answered' ? (
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{q.answer}</p>
                  ) : (
                    <p className="text-[12.5px] text-muted">Not answered yet. Claude Code answers it the next time you ask it to, here, at no cost.</p>
                  )}
                  <div className="flex gap-3">
                    {q.asked_via !== 'claude_code' && (
                      <button type="button" onClick={() => onAsk?.(q.question)} className="text-[12px] text-muted underline underline-offset-[3px] hover:text-ink">
                        {q.asked_via === 'claude' ? 'Ask again here (free)' : 'Ask again'}
                      </button>
                    )}
                    <button type="button" onClick={() => dismiss(q)} className="text-[12px] text-muted underline underline-offset-[3px] hover:text-ink">
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
