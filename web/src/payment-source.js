/**
 * Words for where a card payment came from (D199). The API sends each
 * card payment's `payment_source` (its matched bank row, or why there
 * isn't one); this turns it into the name the table shows and the
 * sentence its ＋ opens. Pure: tested in payment-source.test.js.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const longDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
};
const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** "SoFi" when it's the only account at that bank, else "Bank of America ···5508". */
export function bankLabel(acct) {
  if (!acct) return null;
  const name = acct.issuer || acct.account_name;
  return acct.accounts_at_bank > 1 && acct.mask ? `${name} ···${acct.mask}` : name;
}

const KIND = { CHECKING: 'checking', SAVINGS: 'savings' };

/** "SoFi checking", or "Bank of America checking ···5508" when there's more than one account there. */
const accountWords = (b) =>
  `${b.issuer || b.account_name}${KIND[b.account_type] ? ` ${KIND[b.account_type]}` : ''}${b.accounts_at_bank > 1 && b.mask ? ` ···${b.mask}` : ''}`;

/**
 * The table's name for a card payment whose source is known, in the
 * household's chosen friendly style (D199, D200):
 *   bank       "Paid by SoFi checking"
 *   person     "Paid by Alex"
 *   cash       "Paid in cash at an ATM · Riverton, NC"
 *   outside    "Paid from Robinhood" (set by hand)
 *   statement  "Paid by Bank of America checking ···5504" — named by the
 *              card's own line, its bank statement not uploaded yet
 * null when the source isn't known.
 */
export function paymentName(src) {
  if (!src || src.status === 'unverified') return null;
  if (src.status === 'named') {
    if (src.likely) return `Paid by ${accountWords(src.likely)}`;
    return src.named_issuer ? `Paid by ${src.named_issuer}` : null;
  }
  switch (src.via) {
    case 'person': return src.person ? `Paid by ${src.person}` : null;
    case 'cash': return src.location ? `Paid in cash at an ATM · ${src.location}` : 'Paid in cash';
    case 'outside': return src.label ? `Paid from ${src.label}` : null;
    default: return src.bank ? `Paid by ${accountWords(src.bank)}` : null;
  }
}

/**
 * The other side of the same link, on the bank row: "Paid off your Blue
 * Cash Preferred", or for a Zelle "Paid Alex back for your Customized
 * Cash Rewards" / "Alex paid your Customized Cash Rewards" on a Zelle
 * linked to a payment she made. ···mask only if two cards share the name.
 */
export function targetName(target) {
  if (target?.status !== 'verified' || !target.card) return null;
  const c = target.card;
  const card = `${c.account_name}${c.accounts_with_name > 1 && c.mask ? ` ···${c.mask}` : ''}`;
  // A link, not a claim of repayment (D217): money to that person may also be a loan.
  return target.via === 'person' && target.person ? `${target.person} paid your ${card}` : `Paid off your ${card}`;
}

/**
 * A matched row's display, either side: its name, the logo to show
 * (the other side's bank or card issuer; the Zelle mark for a person;
 * the card-payment glyph for cash), and the link for the mark.
 * null for a row whose source isn't known.
 */
export function linkedDisplay(t) {
  const src = t.payment_source;
  const name = paymentName(src);
  if (name) {
    const logo = src.via === 'bank' && src.bank ? src.bank.issuer : src.status === 'named' ? src.likely?.issuer ?? src.named_issuer : null;
    return { name, logo, zelle: src.via === 'person', link: src };
  }
  const target = targetName(t.payment_target);
  if (target) return { name: target, logo: t.payment_target.card.issuer, zelle: false, link: t.payment_target };
  return null;
}

/** True when the row should ask for attention: a card payment whose source isn't known at all. */
export const needsAttention = (t) => t.payment_source?.status === 'unverified';

const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What the ＋ panel says.
 * @returns { verified, named, title, lines: [string] }
 */
export function paymentExplanation(src, postedDate, target = null) {
  if (!src && target?.status === 'verified') {
    const c = target.card;
    if (target.via === 'person') {
      return {
        verified: true,
        title: `Linked: ${targetName(target)}`,
        lines: [
          `${target.person} paid ${c.account_name}${c.mask ? ` ···${c.mask}` : ''} on ${day(c.posted_date)}, and ${target.part_count > 1 ? `${n(target.part_count, 'Zelle')} to them add up to it` : 'this Zelle to them is the same amount'}.`,
          'How this Zelle counts is up to you: it stays as you filed it.',
        ],
      };
    }
    return {
      verified: true,
      title: `Verified: ${targetName(target).replace('Paid off', 'paid off')}`,
      lines: [
        `${c.account_name}${c.mask ? ` ···${c.mask}` : ''} shows this payment arriving on ${day(c.posted_date)}${target.part_count > 1 ? `, together with ${n(target.part_count - 1, 'other bank row')} adding up to it` : ''}.`,
        `On that statement: ${c.description}`,
      ],
    };
  }
  if (!src) return null;
  if (src.status === 'verified' && src.via === 'person') {
    return {
      verified: true,
      title: `Verified: paid by ${src.person}`,
      lines: [`${src.person} paid this, and was paid back by Zelle${src.part_count > 1 ? ` in ${src.part_count} parts adding up to it` : ' for the same amount'}, within a few days.`],
    };
  }
  if (src.status === 'verified' && src.via === 'cash') {
    return { verified: true, title: 'Verified: paid in cash', lines: [src.location ? `Cash paid in at an ATM in ${src.location}. No bank account was involved, so there’s no bank row to match.` : 'Paid in cash. No bank account was involved, so there’s no bank row to match.'] };
  }
  if (src.status === 'verified' && src.via === 'outside') {
    return { verified: true, title: `Verified by hand: paid from ${src.label}`, lines: ['Marked by hand as paid from an account that isn’t in the app.'] };
  }
  if (src.status === 'verified') {
    const days = src.bank.posted_date && postedDate ? Math.round((Date.parse(src.bank.posted_date) - Date.parse(postedDate.slice(0, 10))) / 86_400_000) : null;
    const when = days == null ? '' : days === 0 ? ', the same day' : days > 0 ? `, ${days} day${days === 1 ? '' : 's'} later` : `, ${-days} day${days === -1 ? '' : 's'} earlier`;
    return {
      verified: true,
      title: `Verified: paid from ${bankLabel(src.bank)}`,
      lines: [
        src.split
          ? `${src.bank.account_name}${src.bank.mask ? ` ···${src.bank.mask}` : ''} sent it in ${n(src.part_count, 'payment')} that add up to it, starting ${day(src.bank.posted_date)}.`
          : `${src.bank.account_name}${src.bank.mask ? ` ···${src.bank.mask}` : ''} sent the same amount on ${day(src.bank.posted_date)}${when}.`,
        `On that statement: ${src.bank.description}`,
      ],
    };
  }
  if (src.status === 'named') {
    const who = paymentName(src).replace(/^Paid by /, '');
    const after = src.window && src.covered_until && src.window.from > src.covered_until;
    const before = src.window && src.covered_from && src.window.to < src.covered_from;
    return {
      verified: false,
      named: true,
      title: `Named by the card: paid by ${who}`,
      lines: [
        'The card statement says where this came from.',
        src.reason === 'no_match'
          ? `But ${who}’s statement for those dates doesn’t show it leaving. Check the amount on both statements.`
          : src.covered_from && before ? `To confirm it, upload ${who}’s statement covering ${day(postedDate.slice(0, 10))}. Its statements in the app start ${longDay(src.covered_from)}.`
            : src.covered_until && after ? `To confirm it, upload ${who}’s statement that starts ${day(nextDay(src.covered_until))}.`
              : `To confirm it, upload ${who}’s statement covering ${postedDate ? day(postedDate.slice(0, 10)) : 'those dates'}.`,
      ],
    };
  }
  const likely = bankLabel(src.likely);
  switch (src.reason) {
    case 'statement_missing': {
      const at = postedDate ? day(postedDate.slice(0, 10)) : 'that date';
      if (!likely || !src.covered_until) {
        return { verified: false, title: 'Not verified yet: a bank statement is missing', lines: ['A bank statement covering these dates isn’t uploaded yet. Upload it and this is checked again automatically.'] };
      }
      const before = src.window && src.covered_from && src.window.to < src.covered_from;
      const after = src.window && src.window.from > src.covered_until;
      return {
        verified: false,
        title: 'Not verified yet: a bank statement is missing',
        lines: [
          before ? `This most likely came from ${likely}, but its statements in the app start ${longDay(src.covered_from)}.`
            : after ? `This most likely came from ${likely}, but its statements in the app end ${day(src.covered_until)}.`
              : `This most likely came from ${likely}, but its statement covering ${at} isn’t in the app.`,
          after ? `Upload the ${likely} statement that starts ${day(nextDay(src.covered_until))}. It's checked again automatically, and this turns verified once the payment is found.`
            : `Upload the ${likely} statement covering ${at}. It's checked again automatically, and this turns verified once the payment is found.`,
        ],
      };
    }
    case 'ambiguous':
      return {
        verified: false,
        title: 'Not verified: more than one bank row fits',
        lines: [`${src.candidate_count} bank withdrawals match this amount and date equally well, so none was picked.`],
      };
    default:
      return {
        verified: false,
        title: 'Not verified: no bank sent this amount',
        lines: [
          'Every bank account in the app is covered for these dates, and none has a matching withdrawal.',
          'It was probably paid from an account that isn’t in the app.',
        ],
      };
  }
}

/**
 * A group of bank card bills no card payment matched (Review → Payments).
 * @returns { title, lines, tone }
 */
export function billGroupText(g) {
  const who = g.card ? g.card.name : g.candidates?.length ? g.candidates.join(' and ') : g.issuer ? `${/^[AEIOU]/.test(g.issuer) ? 'An' : 'A'} ${g.issuer} card` : 'A card';
  const n = `${g.count} payment${g.count === 1 ? '' : 's'}`;
  switch (g.reason) {
    case 'card_statement_missing':
      return {
        tone: 'muted',
        title: `${who}: statement for ${monthName(g.month)} missing`,
        lines: [g.covered_from
          ? `${n} left the bank, but ${g.card ? 'this card’s' : 'their'} statements in the app run ${longDay(g.covered_from)} to ${longDay(g.covered_until)}. Upload the one covering ${monthName(g.month)}.`
          : `${n} left the bank, but no statements for ${g.card ? 'this card' : 'it'} are in the app yet.`],
      };
    case 'not_on_card':
      return {
        tone: 'spend',
        title: g.issuer ? `Paid to another ${g.issuer} card?` : 'Paid to another card?',
        lines: [`${who} ${g.candidates?.length > 1 ? 'are' : 'is'} covered for ${monthName(g.month)}, and none shows this payment. It probably went to another ${g.issuer ?? ''} card. Add it to see what was bought on it.`.replace('another  card', 'another card')],
      };
    case 'card_not_in_app':
      return { tone: 'spend', title: `${g.issuer} card isn’t in the app`, lines: [`${n} went to ${/^[AEIOU]/.test(g.issuer) ? 'an' : 'a'} ${g.issuer} card in ${monthName(g.month)}. Add the card and upload its statements to see what was bought on it.`] };
    default:
      return { tone: 'muted', title: 'A bill to an unknown card', lines: [`“${g.label}” in ${monthName(g.month)} doesn’t name a card. Check whether it’s really a card payment.`] };
  }
}
