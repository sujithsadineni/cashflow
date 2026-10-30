import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashbackKind, cashbackYear } from './cashback.js';

test('cashback rows by kind: rewards paid out, offers, bonuses, Daily Cash clawbacks', () => {
  assert.equal(cashbackKind('CASH REWARDS STATEMENT CREDIT'), 'rewards');
  assert.equal(cashbackKind('YOUR CASH REWARD/REFUND IS'), 'rewards');
  assert.equal(cashbackKind('Bank of America DES:CASHREWARD ID:X'), 'rewards');
  assert.equal(cashbackKind('Daily Cash redemption'), 'rewards');
  assert.equal(cashbackKind('FOOD LION 2196 - Amex Offer Credit'), 'offer');
  assert.equal(cashbackKind('Money Referral Bonus'), 'bonus');
  assert.equal(cashbackKind('$300 For New Checking'), 'bonus');
  assert.equal(cashbackKind('Daily Cash Adjustment · TARGET'), 'clawback');
});

const accounts = [
  { id: 1, name: 'Held Card', issuer: 'Bank of America', mask: '1111', account_type: 'CREDIT_CARD' },
  { id: 2, name: 'Paid-out Card', issuer: 'Goldman Sachs Bank USA', mask: '2222', account_type: 'CREDIT_CARD' },
  { id: 3, name: 'Checking', issuer: 'SoFi', mask: '3333', account_type: 'CHECKING' },
];
const statements = [
  // Holds a balance: earned is printed, but the money arrives when redeemed.
  { account_id: 1, period_end: '2026-01-13', cashback_earned_cents: 1000, cashback_balance_cents: 1000 },
  { account_id: 1, period_end: '2026-02-13', cashback_earned_cents: 500, cashback_balance_cents: 300 },
  // Pays out at once: no balance ever printed.
  { id: 7, account_id: 2, period_end: '2026-01-31', cashback_earned_cents: 1400, cashback_balance_cents: null },
  { account_id: 2, period_end: '2025-12-31', cashback_earned_cents: 900, cashback_balance_cents: null },
];
const rows = [
  { id: 10, account_id: 1, posted_date: '2026-02-05', amount_cents: 1200, description: 'CASH REWARDS STATEMENT CREDIT' },
  { id: 11, account_id: 2, posted_date: '2026-01-02', amount_cents: 3032, description: 'Daily Cash redemption' },
  { id: 12, account_id: 2, posted_date: '2026-01-20', amount_cents: -54, description: 'Daily Cash Adjustment · NIKE' },
  { id: 13, account_id: 3, posted_date: '2026-03-25', amount_cents: 40000, description: 'Money Promo Bonus' },
  { id: 14, account_id: 1, posted_date: '2026-02-20', amount_cents: 529, description: 'BANKAMERIDEALS CASHBACK' },
];
const interest = [{ account_id: 3, posted_date: '2026-02-28', amount_cents: 26 }, { account_id: 3, posted_date: '2026-02-28', amount_cents: -10 }];

test('money back is counted once, when received (D283)', () => {
  const y = cashbackYear({ rows, statements, interest, accounts, year: '2026' });
  // Held card: its redemption (not its printed earned). Paid-out card: its printed figure (not its redemption), less the clawback.
  assert.equal(y.by_kind.rewards, 1200 + 1400);
  assert.equal(y.by_kind.clawback, -54);
  assert.equal(y.by_kind.offer, 529);
  assert.equal(y.by_kind.bonus, 40000);
  assert.equal(y.by_kind.interest, 26);
  assert.equal(y.total_cents, 1200 + 1400 - 54 + 529 + 40000 + 26);
  assert.equal(y.months[1].total, 1200 + 529 + 26);
  assert.ok(!y.items.some((i) => i.id === 11), "the paid-out card's redemption isn't money back again");
  // Every part of the total is an item: the paid-out card's statement, and interest.
  assert.equal(y.items.reduce((a, i) => a + i.amount_cents, 0), y.total_cents);
  assert.equal(y.items.find((i) => i.source === 'statement').amount_cents, 1400);
});

test("a held card's newest printed balance is waiting; a paid-out card has none", () => {
  const y = cashbackYear({ rows, statements, interest, accounts, year: '2026' });
  const held = y.cards.find((c) => c.account_id === 1);
  assert.deepEqual([held.waiting_cents, held.waiting_as_of, held.how, held.waiting_stale], [300, '2026-02-13', 'redeemed', false]);
  assert.equal(y.cards.find((c) => c.account_id === 2).waiting_cents, null);
  assert.equal(y.waiting_cents, 300);
  // A newer statement without a printed balance makes the last one stale.
  const later = cashbackYear({ rows, statements: [...statements, { account_id: 1, period_end: '2026-03-13', cashback_earned_cents: null, cashback_balance_cents: null }], interest, accounts, year: '2026' });
  assert.equal(later.cards.find((c) => c.account_id === 1).waiting_stale, true);
});

test('another year sees only its own money', () => {
  const y = cashbackYear({ rows, statements, interest, accounts, year: '2025' });
  assert.equal(y.total_cents, 900);
  assert.equal(y.cards.length, 1);
});

test('a gift card counts its value on the day it came, and its reward dollars come off what the card is holding (D330)', () => {
  const gift = (over) => ({ id: 1, account_id: 1, redeemed_on: '2026-03-02', brand: 'Bookshop', value_cents: 250, rewards_used_cents: 200, points_used: null, note: null, ...over });
  const year = cashbackYear({ rows: [], statements, interest: [], accounts, redemptions: [gift({})], year: '2026' });
  assert.equal(year.by_kind.giftcard, 250);
  assert.equal(year.months[2].giftcard, 250);
  const item = year.items.find((i) => i.kind === 'giftcard');
  assert.deepEqual([item.amount_cents, item.posted_date, item.source, item.brand], [250, '2026-03-02', 'redemption', 'Bookshop']);
  assert.equal(year.cards.find((c) => c.account_id === 1).waiting_cents, 100, '300 printed in February, 200 spent after');

  const before = cashbackYear({ rows: [], statements, interest: [], accounts, redemptions: [gift({ redeemed_on: '2026-02-01' })], year: '2026' });
  assert.equal(before.cards.find((c) => c.account_id === 1).waiting_cents, 300, 'spent before the balance was printed: already out of it');
  const points = cashbackYear({ rows: [], statements, interest: [], accounts, redemptions: [gift({ rewards_used_cents: null, points_used: 2500 })], year: '2026' });
  assert.equal(points.cards.find((c) => c.account_id === 1).waiting_cents, 300, 'points say nothing about the dollars held');
});

test("an Amex balance printed as of the previous closing date doesn't still hold a payout made after that day (D331)", () => {
  // The September statement prints Reward Dollars 143.27 as of Aug 25; 120.00 was paid out on Sep 9.
  const amex = [
    { account_id: 1, period_end: '2026-08-25', cashback_earned_cents: null, cashback_balance_cents: 12000, cashback_balance_as_of: '2026-07-24' },
    { account_id: 1, period_end: '2026-09-24', cashback_earned_cents: null, cashback_balance_cents: 14327, cashback_balance_as_of: '2026-08-25' },
  ];
  const payout = { id: 20, account_id: 1, posted_date: '2026-09-09', amount_cents: 12000, description: 'YOUR CASH REWARD/REFUND IS' };
  const y = cashbackYear({ rows: [payout], statements: amex, interest: [], accounts, year: '2026' });
  const c = y.cards.find((x) => x.account_id === 1);
  assert.deepEqual([c.received_cents, c.waiting_cents, c.waiting_as_of, c.waiting_paid_since_cents], [12000, 2327, '2026-08-25', 12000]);

  // A payout on or before the as-of day is already out of the printed figure.
  const early = cashbackYear({ rows: [{ ...payout, posted_date: '2026-08-25' }], statements: amex, interest: [], accounts, year: '2026' });
  assert.equal(early.cards.find((x) => x.account_id === 1).waiting_cents, 14327);
  // No as-of date (BofA): a redemption is already out of the balance, though its credit posts the day after closing.
  const bofa = cashbackYear({ rows: [{ ...payout, posted_date: '2026-09-25' }], statements: amex.map((s) => ({ ...s, cashback_balance_as_of: null })), interest: [], accounts, year: '2026' });
  assert.equal(bofa.cards.find((x) => x.account_id === 1).waiting_cents, 14327);
});
