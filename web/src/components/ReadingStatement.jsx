import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * What the Statements page shows while a statement uploads and is
 * read (D172): a small page with a reading line sweeping down it, and
 * the step being worked on. The steps are the pipeline's real stages,
 * but the parse is one request with no progress to report, so they
 * advance on a timer and hold on the last one, never loop. A loop
 * would pretend to know more than it does.
 *
 * Leads into the reveal on Review (D171): same reading line, same
 * pine accent.
 */
const STEPS = {
  PDF: ['Uploading the file', 'Finding the pages with transactions', 'Reading each line', 'Matching merchants', 'Checking the total'],
  CSV: ['Uploading the file', 'Reading each line', 'Matching merchants', 'Checking the total'],
};

export function ReadingStatement({ fileName, fileType }) {
  const steps = STEPS[fileType] ?? STEPS[/\.csv$/i.test(fileName ?? '') ? 'CSV' : 'PDF'];
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= steps.length - 1) return undefined;
    const t = setTimeout(() => setStep((s) => s + 1), 2600);
    return () => clearTimeout(t);
  }, [step, steps.length]);

  return (
    <div role="status" className="mt-3 flex items-center gap-3 rounded-lg border border-rule bg-band/40 px-3 py-2.5">
      {/* The page being read. */}
      <div aria-hidden="true" className="relative h-14 w-11 shrink-0 overflow-hidden rounded-[5px] border border-rule-str bg-raised px-1.5 py-2">
        {[80, 60, 90, 50, 75, 65].map((w, i) => (
          <motion.div
            key={i}
            className="mb-1 h-[3px] rounded-full bg-rule-str"
            style={{ width: `${w}%` }}
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 2, delay: i * 0.25, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
        <motion.div
          className="absolute inset-x-0 h-3 border-y border-earn/50 bg-earn/15"
          initial={{ top: '-15%' }}
          animate={{ top: ['-15%', '100%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-5 overflow-hidden text-sm text-ink">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={step}
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -14, opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="truncate"
            >
              {steps[step]}…
            </motion.div>
          </AnimatePresence>
        </div>
        {fileName && <div className="truncate text-xs text-faint">{fileName}</div>}
        <div className="mt-1.5 flex gap-1" aria-hidden="true">
          {steps.map((_, i) => (
            <motion.span
              key={i}
              className="h-1 flex-1 rounded-full"
              animate={{
                backgroundColor: i <= step ? 'var(--color-earn)' : 'var(--color-rule)',
                // The step in progress pulses; only finished steps sit solid.
                opacity: i === step ? [0.35, 1, 0.35] : 1,
              }}
              transition={{ backgroundColor: { duration: 0.6 }, opacity: { duration: 1.6, repeat: i === step ? Infinity : 0 } }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
