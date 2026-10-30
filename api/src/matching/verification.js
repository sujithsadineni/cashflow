/**
 * Account-verification micro-deposits (D177). Linking one bank account
 * to another sends a couple of tiny credits (say 9¢ and 17¢), and the
 * other bank usually pulls the same total back a day or two later.
 * They're neither income nor spending, so they get their own category
 * and the type 'transfer', which every total already leaves out.
 *
 * Either signal is enough:
 *   1. the bank says so ("ACCTVERIFY", "verification", "trial deposit",
 *      "micro deposit") on an amount under $1, or
 *   2. the shape alone: two credits under $1 on the same account
 *      within 3 days, then a debit of exactly their sum within 7 days.
 *      To the cent, which ordinary small cashback or interest never does.
 *
 * Unlike the re-check (D175) this marks rows itself: the owner asked
 * for that, and the evidence is exact. It's the same kind of fixed rule
 * as parse/bilt-rent.js. Every mark is audited and can be edited back.
 *
 * Pure: rows in, the indexes of verification rows out.
 */

export const VERIFICATION_CATEGORY = 'Account Verification';
const LABEL = /acct\s*verif|account\s*verif|verification|trial\s*deposit|micro[\s-]*deposit/i;
const SMALL = 100; // cents
const DAY = 86_400_000;

const days = (a, b) => (new Date(b) - new Date(a)) / DAY;

/**
 * @param rows - { account_id, posted_date ('YYYY-MM-DD'), amount_cents, description }
 * @returns Set of indexes into `rows`
 */
export function findVerification(rows) {
  const found = new Set();
  rows.forEach((r, i) => {
    if (r.amount_cents != null && r.amount_cents !== 0 && Math.abs(r.amount_cents) < SMALL && LABEL.test(r.description ?? '')) found.add(i);
  });

  const credits = rows
    .map((r, i) => ({ ...r, i }))
    .filter((r) => r.amount_cents > 0 && r.amount_cents < SMALL && r.posted_date);
  for (let a = 0; a < credits.length; a++) {
    for (let b = a + 1; b < credits.length; b++) {
      const [x, y] = [credits[a], credits[b]];
      if (x.account_id !== y.account_id || Math.abs(days(x.posted_date, y.posted_date)) > 3) continue;
      const later = x.posted_date > y.posted_date ? x.posted_date : y.posted_date;
      const debit = rows.findIndex(
        (d, k) =>
          !found.has(k) &&
          d.account_id === x.account_id &&
          d.amount_cents === -(x.amount_cents + y.amount_cents) &&
          d.posted_date &&
          days(later, d.posted_date) >= 0 &&
          days(later, d.posted_date) <= 7
      );
      if (debit >= 0) [x.i, y.i, debit].forEach((k) => found.add(k));
    }
  }
  return found;
}
