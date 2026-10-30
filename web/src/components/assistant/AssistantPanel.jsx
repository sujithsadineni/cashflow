import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { invalidate, useApi } from '../../hooks/use-api';
import { matchSuggestions, SUGGESTIONS } from '../../lib/assistant/suggestions';
import { Segmented } from '../ui/Form';
import { AnswerView } from './AnswerView';
import { SavedQuestions } from './SavedQuestions';
import { SparkIcon } from './SparkIcon';

/**
 * The assistant's panel (D332), above the corner buttons: a question, the
 * suggestions that hold every word typed (built from what this household
 * spends on most), and three ways to answer it. Answer here (step 3) reads
 * it on this computer, free, and shows the answer in place; Save for
 * Claude Code (step 2) keeps it for a session to answer; Ask Claude (step
 * 4, the API, paid per question) answers it with read-only lookups, only
 * when pressed for that question. Every question lands in History.
 */

const MODES = [
  { key: 'local', title: 'Answer here', hint: 'Local · free, instant' },
  { key: 'claude', title: 'Ask Claude', hint: 'API · paid per question' },
];

export function AssistantPanel({ onClose, questions = [], unseen = 0 }) {
  const [view, setView] = useState(unseen > 0 ? 'history' : 'ask');
  const [text, setText] = useState('');
  const [sel, setSel] = useState(-1);
  const [result, setResult] = useState(null); // the question row Answer here saved, with answer_detail
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 'local' | 'claude' | 'later' while a request runs
  const fieldRef = useRef(null);
  const { data: suggested } = useApi('assistant:suggestions', () => api.assistant.suggestions());
  // An answer stays on screen until the question is changed; then the suggestions come back.
  const showingAnswer = result && result.question === text.trim();
  const list = showingAnswer ? [] : matchSuggestions(text, suggested ?? SUGGESTIONS);

  useEffect(() => {
    if (view === 'ask') fieldRef.current?.focus();
  }, [view]);

  const type = (value) => {
    setText(value);
    setSel(-1);
    setError(null);
  };
  const choose = (s) => {
    type(s.text);
    fieldRef.current?.focus();
  };

  const run = async (mode, question) => {
    setBusy(mode);
    setError(null);
    try {
      if (mode === 'local') {
        setResult(await api.assistant.ask(question));
      } else if (mode === 'claude') {
        setResult(await api.assistant.askClaude(question));
      } else {
        const saved = await api.assistant.saveForLater(question);
        type('');
        setResult(null);
        setSavedId(saved.id);
        setView('history');
      }
      invalidate('assistant');
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const ask = (mode, question = text.trim()) => {
    if (!question) return fieldRef.current?.focus();
    if (question !== text) type(question);
    return run(mode, question);
  };

  const onKeyDown = (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length > 0) {
      e.preventDefault();
      const n = list.length;
      setSel((i) => (e.key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (sel >= 0 && list[sel]) ask('local', list[sel].text);
      else ask('local');
    }
  };

  return (
    <section
      role="dialog"
      aria-label="Ask about your money"
      className="assistant-panel dropdown-panel apple-pane fixed inset-x-4 bottom-[76px] z-40 flex max-h-[min(640px,calc(100vh-112px))] flex-col rounded-2xl border border-rule bg-raised shadow-lg sm:inset-x-auto sm:right-5 sm:w-[440px]"
    >
      <header className="flex items-center gap-2.5 px-4 pb-2.5 pt-3.5">
        <SparkIcon size={18} still />
        <h2 className="flex-1 text-sm font-semibold text-ink max-sm:sr-only">Ask about your money</h2>
        <span className="flex-1 sm:hidden" aria-hidden="true" />
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[{ value: 'ask', label: 'Ask' }, { value: 'history', label: questions.length > 0 ? `History · ${questions.length}` : 'History' }]}
        />
        <button type="button" onClick={onClose} aria-label="Close" className="flex size-7 items-center justify-center rounded-lg text-lg leading-none text-muted hover:bg-band">
          ×
        </button>
      </header>

      {view === 'history' ? (
        <div className="flex-1 overflow-auto px-3 pb-3">
          <SavedQuestions questions={questions} highlight={savedId} onAsk={(q) => { setView('ask'); ask('local', q); }} />
        </div>
      ) : (
        <>
          <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-2.5 overflow-y-auto px-4">
            <textarea
              ref={fieldRef}
              value={text}
              onChange={(e) => type(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="How much did I spend on rent this year?"
              aria-label="Your question"
              aria-controls="assistant-suggestions"
              className="min-h-16 w-full resize-none rounded-xl border border-rule-str bg-raised px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-ink"
            />

            {busy === 'local' && <p className="px-0.5 text-[12.5px] text-muted">Looking it up…</p>}
            {busy === 'claude' && <p className="px-0.5 text-[12.5px] text-muted">Asking Claude… it looks things up first, so this can take a little while.</p>}
            {showingAnswer && !busy && <AnswerView detail={result.answer_detail} onAsk={(q) => ask('local', q)} />}
            {error && <p role="alert" className="text-[12.5px] text-spend">{error}</p>}

            {!showingAnswer && (
              <div id="assistant-suggestions" role="listbox" aria-label="Suggested questions" className="grid gap-0.5">
                {!text.trim() && <p className="px-0.5 pt-1 text-xs text-faint">Try one of these</p>}
                {list.map((s, i) => (
                  <button
                    key={s.text}
                    type="button"
                    role="option"
                    aria-selected={i === sel}
                    onClick={() => choose(s)}
                    className={`flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-band ${i === sel ? 'bg-band' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      {s.parts.map((p, j) => (p.hit ? <b key={j} className="font-semibold">{p.text}</b> : <span key={j}>{p.text}</span>))}
                    </span>
                    <span className="shrink-0 text-[11px] text-faint">{s.note}</span>
                  </button>
                ))}
                {text.trim() && list.length === 0 && !showingAnswer && (
                  <p className="px-0.5 pt-1 text-xs text-faint">No suggested question matches. You can still ask it.</p>
                )}
              </div>
            )}
          </div>

          <footer className="grid grid-cols-2 gap-2 px-4 pb-2 pt-3">
            {MODES.map((m, i) => (
              <button
                key={m.key}
                type="button"
                onClick={() => ask(m.key)}
                disabled={busy !== null}
                className={`grid gap-px rounded-xl border px-3 py-2 text-left disabled:opacity-60 ${i === 0 ? 'border-ink bg-ink text-paper' : 'border-rule-str bg-raised text-ink hover:bg-band'}`}
              >
                <span className="text-[13.5px] font-semibold">{m.title}</span>
                <span className={`text-[11.5px] ${i === 0 ? 'opacity-70' : 'text-muted'}`}>{m.hint}</span>
              </button>
            ))}
          </footer>
          <button
            type="button"
            onClick={() => ask('later')}
            disabled={busy !== null}
            className="self-start px-4 pb-3.5 text-left text-[12.5px] text-muted underline underline-offset-[3px] hover:text-ink disabled:opacity-50"
          >
            {busy === 'later' ? 'Saving…' : 'Save for Claude Code to answer later'}
          </button>
        </>
      )}
    </section>
  );
}
