/**
 * Rewards as a card statement prints them (D351, statement-extraction
 * step 3). Pure; tested in rewards.test.js. Read, never calculated
 * (CLAUDE.md): a part the statement doesn't print is left out.
 *
 *   Bank of America "Your Reward Summary", the figure first, sometimes
 *   without a leading zero: ".45 Base Cash Back Earned", "3.76 Category Bonus
 *   Earned", ".63 Relationship Bonus Earned", "92.57 Cash Back Redeemed",
 *   "6.33 Total Cash Back Available".
 *   Frontier (Barclays): "Total Miles Sent to Frontier Airlines 1,966".
 *
 * Returns { rewards, cashback_earned_cents }: rewards null when nothing was
 * printed; cashback_earned_cents the sum of Bank of America's printed
 * earned parts, null otherwise (other readers already set it).
 */
const LEADING = '(\\d[\\d,]*\\.\\d{2}|\\.\\d{2})';
const BOFA = {
  base_cents: 'Base Cash Back Earned',
  bonus_cents: 'Category Bonus Earned',
  relationship_cents: 'Relationship Bonus Earned',
  redeemed_cents: 'Cash Back Redeemed',
  available_cents: 'Total Cash Back Available',
};
const cents = (text) => Math.round(Number(text.replace(/,/g, '')) * 100);

export function readRewards(text) {
  const lines = (text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rewards = {};
  for (const [key, label] of Object.entries(BOFA)) {
    for (const line of lines) {
      // A trailing minus is cash back taken back (".25- Base Cash Back Earned" after a return).
      const m = line.match(new RegExp(`^\\$?\\s?${LEADING}(-)?\\s+${label}\\b`, 'i'));
      if (m) { rewards[key] = m[2] ? -cents(m[1]) : cents(m[1]); break; }
    }
  }
  for (const line of lines) {
    const m = line.match(/^Total Miles Sent to (.+?) ([\d,]+)$/i);
    if (m) { rewards.miles = Number(m[2].replace(/,/g, '')); rewards.miles_to = m[1].trim(); break; }
  }
  const parts = ['base_cents', 'bonus_cents', 'relationship_cents'].filter((k) => rewards[k] != null);
  return {
    rewards: Object.keys(rewards).length ? rewards : null,
    cashback_earned_cents: parts.length ? parts.reduce((s, k) => s + rewards[k], 0) : null,
  };
}
