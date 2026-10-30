/**
 * The facts every card statement prints beyond its rows (D346, D349): the
 * credit line, the year-to-date box, the APRs and a terms notice (D350), read from all the pages' text the same way
 * whichever reader (or Claude, D182) read the rows, as the due date and
 * promos are (D270, D192). Not printed → null.
 */
import { readCreditLine } from './credit-line.js';
import { readYtd } from './ytd.js';
import { readAprs } from './apr.js';
import { readTermsNotice } from './notice.js';
import { readRewards } from './rewards.js';
import { readPlans } from './plans.js';

export function readCardFacts(pages) {
  const text = pages.map((p) => p.text ?? '').join('\n');
  // Rewards as printed (D351). Its earned figure only when Bank of America printed the parts:
  // these facts are spread over the reader's own, and a null mustn't wipe Apple's or Barclays'.
  const { rewards, cashback_earned_cents } = readRewards(text);
  return {
    ...readCreditLine(text), ...readYtd(text), ...readAprs(text), terms_notice: readTermsNotice(text), rewards, plans: readPlans(text),
    ...(cashback_earned_cents != null ? { cashback_earned_cents } : {}),
  };
}
