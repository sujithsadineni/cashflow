/**
 * Words for a transfer between the household's own accounts (D265). The
 * API sends `transfer_link` on both halves; this names the other one.
 * Pure: tested in transfer-link.test.js.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

/** "Chase Total Checking", or "Adv SafeBalance Banking ···5115" when two accounts share the name. */
const accountWords = (l) => `${l.account_name}${l.accounts_with_name > 1 && l.mask ? ` ···${l.mask}` : ''}`;

/** "From Chase Total Checking" on the money that arrived, "To Personal Savings" on the money that left. */
export function transferName(link) {
  if (!link) return null;
  return `${link.direction === 'from' ? 'From' : 'To'} ${accountWords(link)}`;
}

/** The opened row's sentence: the title, and the other half as its statement printed it. */
export function transferExplanation(link) {
  if (!link) return null;
  return {
    title: transferName(link),
    lines: [
      link.direction === 'from'
        ? `The same amount left ${accountWords(link)} on ${longDay(link.posted_date)}. Money moved between your own accounts: not income, not spending.`
        : `The same amount arrived in ${accountWords(link)} on ${longDay(link.posted_date)}. Money moved between your own accounts: not income, not spending.`,
      `On that statement: ${link.description}`,
    ],
  };
}

/** What PaymentMark shows for a linked transfer. */
export const TRANSFER_MARK = { status: 'transfer' };
