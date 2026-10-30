import { useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useDesign } from '../../hooks/use-design';
import { useReadingStyle } from '../../hooks/use-reading-style';
import { READING_STYLES, SAMPLE_ROWS, SAMPLE_TALLY } from '../../lib/imports/reading-styles';
import { StatementReveal } from '../review/StatementReveal';
import { StatementSheet } from '../imports/StatementPages';
import { SectionHeader } from '../ui/Form';
import { GroupSection, Group, Row } from './glass-ui';

/**
 * Settings → Animation (D335): how a statement plays as it's read into its
 * rows, one of four styles, per browser like the design. The preview below
 * plays the real thing on a made-up statement, again each time a style is
 * picked or Play again is pressed. Glass gets its own grouped list; the
 * other designs a radio card each, like Settings → Design.
 */

const Check = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-info" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 4.8" />
  </svg>
);
const Letter = ({ letter, selected }) => (
  <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-medium ${selected ? 'bg-info text-white' : 'bg-band text-muted'}`} aria-hidden="true">{letter}</span>
);

/**
 * The preview is the statement's own card in small (D335): the page on the
 * left, always, and the style playing on the right, following it line by line.
 */
function Preview({ style, reduceMotion }) {
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(null);
  if (reduceMotion) {
    return <p className="text-sm text-muted">Reduce Motion is on for this computer, so a statement shows its rows at once and none of these play.</p>;
  }
  return (
    <div className="min-w-0" key={style}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">A made-up statement, read the way yours will be.</p>
        <button type="button" onClick={() => { setDone(false); setProgress(null); setRun((n) => n + 1); }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-[13px] text-ink hover:bg-band">
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
          {done ? 'Play again' : 'Restart'}
        </button>
      </div>
      <div className="grid grid-cols-1 overflow-clip rounded-xl border border-rule bg-raised md:h-[30rem] md:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
        <div className="h-72 min-h-0 border-b border-rule bg-band/60 md:h-auto md:border-r md:border-b-0">
          <StatementSheet rows={SAMPLE_ROWS} progress={done ? { current: null, done: new Set(SAMPLE_ROWS.map((r) => r.id)) } : progress} title="Visa Signature ··4821" reason="sample" />
        </div>
        <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
          {done ? (
            <p className="py-6 text-center text-sm text-muted">That's how it ends: every line ticked on the page, the rows ready to review.</p>
          ) : (
            <StatementReveal key={`${style}-${run}`} rows={SAMPLE_ROWS} tally={SAMPLE_TALLY} style={style} label="Visa Signature ··4821" pageBeside
              onProgress={setProgress} onDone={() => { setProgress(null); setDone(true); }} />
          )}
        </div>
      </div>
    </div>
  );
}

export function AnimationPane() {
  const { design } = useDesign();
  const reduceMotion = useReducedMotion();
  const [style, setStyle] = useReadingStyle();
  const current = READING_STYLES.find((s) => s.value === style);

  if (design === 'glass') {
    return (
      <div className="apple-pane grid grid-cols-1 gap-8">
        <GroupSection label="Reading a statement" footnote="Plays once after a statement is read, and again from Replay the reading. Remembered on this browser only.">
          <Group inset={60} as="div" role="radiogroup" aria-label="Reading a statement">
            {READING_STYLES.map((s) => {
              const selected = s.value === style;
              return (
                <Row key={s.value} as="div" wrap onClick={() => setStyle(s.value)} actionProps={{ role: 'radio', 'aria-checked': selected }}
                  leading={<Letter letter={s.letter} selected={selected} />}
                  title={<span className={selected ? 'font-semibold' : ''}>{s.label}</span>}
                  subtitle={s.description}
                  trailing={selected ? <Check /> : <span className="w-[15px]" />} />
              );
            })}
          </Group>
        </GroupSection>
        <GroupSection label={`Preview · ${current.label}`}>
          <Group as="div" className="px-4 py-4"><Preview style={style} reduceMotion={reduceMotion} /></Group>
        </GroupSection>
      </div>
    );
  }

  return (
    <section className="apple-pane">
      <SectionHeader title="Animation" emoji="🎞️" tint="bg-vivid-blue/15" />
      <p className="mb-4 max-w-xl text-sm text-muted">
        How a statement plays as it's read into its rows, right after an upload and from Replay the reading. Your choice is remembered on this browser only.
      </p>
      <div role="radiogroup" aria-label="Reading a statement" className="grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {READING_STYLES.map((s) => {
          const selected = s.value === style;
          return (
            <button key={s.value} type="button" role="radio" aria-checked={selected} onClick={() => setStyle(s.value)}
              className={`flex gap-3 rounded-xl border p-4 text-left transition-colors ${selected ? 'border-info bg-info/5 ring-1 ring-info' : 'border-rule hover:border-rule-str hover:bg-band'}`}>
              <Letter letter={s.letter} selected={selected} />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  {s.label}
                  {selected && <span className="text-xs font-normal text-info">In use</span>}
                </span>
                <span className="mt-1 block text-xs text-muted">{s.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-8 max-w-6xl">
        <h4 className="mb-2 text-sm font-medium text-ink">Preview · {current.label}</h4>
        <Preview style={style} reduceMotion={reduceMotion} />
      </div>
    </section>
  );
}
