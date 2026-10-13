/**
 * Words for the Review panel (D197): what each kind of finding means,
 * why it matters, what Approve does, and what it changes in the totals.
 * Kept out of the component so every group explains itself the same way.
 * Money stays as { cents } parts for formatMoney (and privacy mode).
 * Pure: tested in review-groups.test.js.
 */

const sumAbs = (items) => items.reduce((s, i) => s + Math.abs(Number(i.amount_cents) || 0), 0);

/** The three tiers, in the order they're shown. */
export const TIERS = [
  { key: 'fix', title: 'Fix first', blurb: "A statement doesn't add up until these are fixed." },
  { key: 'totals', title: 'Changes your totals', blurb: 'Approving these moves money between spending, income and transfers.' },
  { key: 'tidy', title: 'Labels only', blurb: "Totals stay the same. Only the type or category on the row changes." },
];

/**
 * One entry per check_kind (api/src/recheck.js), in display order within its tier.
 * found: what was seen · why: why it matters · keep: when "Keep as is" is the right call
 * impact(items, sum): the change to the totals if every one is approved
 */
export const GROUPS = {
  amount_sign: {
    tier: 'fix',
    title: 'Saved with the wrong sign',
    found: "The statement's balance only works if this amount is flipped.",
    why: 'A balance transfer or cash advance is new debt on the card. Saved as money in, it hides that debt.',
    keep: 'Only if you know the statement itself was read wrong.',
    impact: (_, sum) => [{ cents: sum }, ' becomes debt on the card, and its statement adds up.'],
  },
  zelle_card_payment: {
    tier: 'totals',
    title: 'Zelle that paid someone back for a card payment',
    found: 'Someone paid one of your cards, and you paid them back by Zelle. The card shows their payment; these Zelles add up to it.',
    why: 'What was bought on the card is already spending. Counting the Zelle back as spending too counts it twice.',
    keep: 'If it was really for something else and only matched by chance.',
    impact: (_, sum) => ['Spending goes down by ', { cents: sum }, '.'],
  },
  card_deposit: {
    tier: 'totals',
    title: 'Card payment counted as income',
    found: 'Money paid into a credit card (cash at an ATM) saved as a deposit.',
    why: 'Every deposit counts as income. Paying a card is moving your own money, not earning it.',
    keep: 'If it really was money you received, like a card refund of a balance.',
    impact: (_, sum) => ['Income goes down by ', { cents: sum }, '.'],
  },
  card_now_tracked: {
    tier: 'totals',
    title: 'Card bill counted twice',
    found: "This bill was counted as spending, but the card's own statements are in the app now.",
    why: 'Its purchases are already counted on the card, so the bill would count them a second time.',
    keep: "If that card's statements don't cover this month.",
    impact: (_, sum) => ['Spending goes down by ', { cents: sum }, '.'],
  },
  type_reward: {
    tier: 'totals',
    title: 'Card reward saved as a refund',
    found: 'Cash back, statement credits and offers saved as refunds.',
    why: "A refund lowers what you spent. A reward doesn't: you still spent the money, the card paid you back.",
    keep: 'If it really was a return of something you bought.',
    impact: (_, sum) => [{ cents: sum }, ' moves from refunds to cashback. Spending goes up by the same amount.'],
  },
  daily_cash: {
    tier: 'totals',
    title: 'Daily Cash taken back, saved as a purchase',
    found: 'After a return, Apple takes back the Daily Cash it paid on that purchase. These rows were saved as purchases.',
    why: "It's cashback given back, not something you bought, so it shouldn't count as spending.",
    keep: null,
    impact: (_, sum) => ['Spending goes down by ', { cents: sum }, '.'],
  },
  abroad: {
    tier: 'totals',
    title: 'Money sent abroad',
    found: 'Remittances (Remitly, Wise and the like) saved as transfers.',
    why: "A transfer is money that stays yours. Money sent abroad has left, so it's spending.",
    keep: 'If it went to your own account abroad that you track here.',
    impact: (_, sum) => ['Spending goes up by ', { cents: sum }, '.'],
  },
  income_internal: {
    tier: 'totals',
    title: 'Counted as income, but it came from your own account',
    found: 'Money in whose other half is money out of another of your accounts.',
    why: 'Moving money between your own accounts is not income.',
    keep: 'If it really came from someone else.',
    impact: (_, sum) => ['Income goes down by ', { cents: sum }, '.'],
  },
  type_category: {
    tier: 'totals',
    title: 'Type and category disagree',
    found: 'The category says one thing and the type says another, like an Amex offer credit filed as Cashback but typed as a refund.',
    why: 'The type decides which total a row counts in. When it disagrees with the category, the row is counted in the wrong place.',
    keep: 'If this row really is the exception.',
    impact: () => ['Fixes whichever side is wrong: the type, or the category when that is the mistake.'],
  },
  type_sign: {
    tier: 'totals',
    title: "Type doesn't match the direction of the money",
    found: 'For example, a purchase that is money in.',
    why: 'The type decides which total a row counts in.',
    keep: 'If the type is right and the row is unusual.',
    impact: () => ['Moves each row to the total its type belongs in.'],
  },
  type_zelle: {
    tier: 'totals',
    title: 'Zelle type',
    found: "A Zelle payment whose type doesn't match who it went to.",
    why: 'Zelle to yourself is a transfer, Zelle to someone else is spending or income.',
    keep: 'If you know who it went to and the type is right.',
    impact: () => ['Moves each row to the total its type belongs in.'],
  },
  type_missing: {
    tier: 'tidy',
    title: 'No type',
    found: 'Rows saved without a type.',
    why: 'Untyped rows are easy to miscount.',
    keep: null,
    impact: () => ['Gives each row the type its history suggests.'],
  },
  type_history: {
    tier: 'tidy',
    title: 'Type differs from the rest of its kind',
    found: 'Other rows from the same merchant have a different type.',
    why: 'Usually a one-off mislabel.',
    keep: 'If this one really is different.',
    impact: () => ['Matches the type you usually give this merchant.'],
  },
  category_missing: {
    tier: 'tidy',
    title: 'No category',
    found: 'Rows saved without a category.',
    why: "They land in Uncategorised on the Overview.",
    keep: null,
    impact: () => ['Gives each row the category its history suggests.'],
  },
  daily_cash_category: {
    tier: 'tidy',
    title: 'Daily Cash taken back, not filed as Cashback',
    found: 'Daily Cash Apple took back after a return, filed under the shop it was returned to.',
    why: 'It belongs with the cashback it reverses.',
    keep: null,
    impact: () => ['Files each row under Cashback.'],
  },
  category_history: {
    tier: 'tidy',
    title: 'Category differs from the rest of its kind',
    found: 'Other rows from the same merchant have a different category.',
    why: 'Usually a one-off mislabel.',
    keep: 'If this one really is different.',
    impact: () => ['Matches the category you usually give this merchant.'],
  },
};

/**
 * Pending findings grouped by tier, then by kind, in display order.
 * A kind the web doesn't know yet still shows, under Labels only.
 * @returns [{ tier, groups: [{ kind, meta, items, sum_cents }] }]
 */
export function groupFindings(items) {
  const byKind = new Map();
  for (const i of items) {
    if (!byKind.has(i.check_kind)) byKind.set(i.check_kind, []);
    byKind.get(i.check_kind).push(i);
  }
  const known = Object.keys(GROUPS);
  const order = [...known, ...[...byKind.keys()].filter((k) => !known.includes(k))];
  return TIERS.map((tier) => ({
    tier,
    groups: order
      .filter((kind) => byKind.has(kind) && (GROUPS[kind]?.tier ?? 'tidy') === tier.key)
      .map((kind) => {
        const list = byKind.get(kind);
        const meta = GROUPS[kind] ?? { tier: 'tidy', title: kind, found: '', why: '', keep: null, impact: () => [] };
        const sum = sumAbs(list);
        return { kind, meta, items: list, sum_cents: sum, impact: meta.impact(list, sum) };
      }),
  })).filter((t) => t.groups.length > 0);
}

/**
 * A statement's gap in words, from its hint (api/src/statement-hints.js).
 * @returns { title, parts, tone, action } — action 'approve' means the fix is one click here
 */
export function statementHintText(hint) {
  switch (hint?.kind) {
    case 'sign_fix':
      return { title: 'One amount has the wrong sign', tone: 'spend', action: 'approve', parts: ['A ', { cents: Math.abs(hint.cents) }, ' row was saved as money in. Flipping it makes the statement add up to the cent.'] };
    case 'duplicate':
      return { title: 'A row looks saved twice', tone: 'spend', action: null, parts: [`“${hint.description}” on ${hint.posted_date.slice(0, 10)} appears twice, and the gap is exactly one of them (`, { cents: Math.abs(hint.cents) }, '). Check it on Transactions.'] };
    case 'missing_draw':
      return { title: 'A transfer or cash advance was not read', tone: 'spend', action: null, parts: [`The statement has ${hint.fee_count === 1 ? 'a transfer fee' : `${hint.fee_count} transfer fees`} but not the transfer itself. `, { cents: hint.cents }, ' of new debt is missing. Re-import this statement.'] };
    case 'small':
      return { title: 'Small gap', tone: 'muted', action: null, parts: ['Off by ', { cents: hint.cents }, '. Usually an interest, rounding or cash-back line the reader skipped. Low priority.'] };
    case 'missing_out':
      return { title: 'Money out is missing', tone: 'spend', action: null, parts: ['The rows are short ', { cents: hint.cents }, ' of money out: a charge or withdrawal was missed, or a credit was read twice.'] };
    case 'extra_out':
      return { title: 'Too much money out', tone: 'spend', action: null, parts: ['The rows have ', { cents: hint.cents }, ' more money out than the statement: a duplicate, or a row from another statement.'] };
    default:
      return { title: "Doesn't add up", tone: 'muted', action: null, parts: ['A row was missed or misread.'] };
  }
}
