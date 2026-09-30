/**
 * Fills a database with an invented household for the public demo.
 * Nothing here comes from real data: two made-up people, six accounts,
 * and twelve months (Oct 2025 – Sep 2026) of transactions drawn from a
 * seeded random generator, so every run produces identical rows.
 *
 *   createdb cashflow_demo && for f in db/*.sql; do psql -d cashflow_demo -f "$f"; done
 *   DATABASE_URL=postgres://localhost/cashflow_demo node api/demo/seed.mjs
 *
 * Refuses to run against a database that already has people in it, so
 * it can never be pointed at a real ledger by mistake.
 */
import { createHash } from 'node:crypto';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (sql, params) => db.query(sql, params);

const { rows: existing } = await q('SELECT count(*)::int AS n FROM person');
if (existing[0].n > 0) {
  console.error('seed: this database already has people in it — refusing to seed. Use a fresh, empty database.');
  process.exit(1);
}

// Seeded PRNG (mulberry32): same data on every run.
let seed = 20260930;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo, hi) => Math.round(lo + rand() * (hi - lo)); // cents
const pick = (list) => list[Math.floor(rand() * list.length)];
const pad = (n) => String(n).padStart(2, '0');
const day = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, new Date(y, m, 0).getDate()))}`;

// ---- Reference data ---------------------------------------------------
const EXTRA_CATEGORIES = ['Investment', 'Zelle', 'Costco', 'Refund', 'Cashback', 'EV Charging', 'Card Payment', 'Salary', 'Loan', 'Interest', 'Annual Fee'];
for (const name of EXTRA_CATEGORIES) await q('INSERT INTO category (name, sort_order) VALUES ($1, 200) ON CONFLICT (name) DO NOTHING', [name]);
await q("UPDATE category SET icon_key = 'trend-up' WHERE name = 'Investment'");
const cat = Object.fromEntries((await q('SELECT id, name FROM category')).rows.map((r) => [r.name, r.id]));

const person = async (name, avatar) => (await q('INSERT INTO person (name, avatar) VALUES ($1, $2) RETURNING id', [name, avatar])).rows[0].id;
const alex = await person('Alex Morgan', '🧔');
const sam = await person('Sam Rivera', '👩‍🦱');

const account = async (personId, name, issuer, type, mask, holder) =>
  (await q(
    'INSERT INTO account (person_id, name, issuer, account_type, mask, holder_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [personId, name, issuer, type, mask, holder],
  )).rows[0].id;
const A = {
  alexChecking: await account(alex, 'Total Checking', 'Chase', 'CHECKING', '5678', 'ALEX J MORGAN'),
  freedom: await account(alex, 'Freedom Flex', 'Chase', 'CREDIT_CARD', '2468', 'ALEX J MORGAN'),
  amex: await account(alex, 'Blue Cash Preferred', 'American Express', 'CREDIT_CARD', '1357', 'ALEX MORGAN'),
  samChecking: await account(sam, 'Adv SafeBalance Banking', 'Bank of America', 'CHECKING', '4321', 'SAM RIVERA'),
  bofaCard: await account(sam, 'Customized Cash Rewards', 'Bank of America', 'CREDIT_CARD', '8642', 'SAM RIVERA'),
  bilt: await account(sam, 'Bilt Blue Card', 'Bilt', 'CREDIT_CARD', null, 'Sam Rivera'),
};
const CARDS = [A.freedom, A.amex, A.bofaCard, A.bilt];
const CHECKING_OF = { [A.freedom]: A.alexChecking, [A.amex]: A.alexChecking, [A.bofaCard]: A.samChecking, [A.bilt]: A.samChecking };

const contact = async (name) => (await q('INSERT INTO contact (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
const FRIENDS = { 'Jordan Lee': await contact('Jordan Lee'), 'Priya Shah': await contact('Priya Shah'), 'Diego Alvarez': await contact('Diego Alvarez') };

// ---- Transactions -----------------------------------------------------
const txns = [];
const add = (accountId, date, description, merchant, cents, category, type, extra = {}) =>
  txns.push({ accountId, date, description, merchant, cents, category, type, ...extra });

const MONTHS = [];
for (let i = 0; i < 12; i++) {
  const d = new Date(2025, 9 + i, 1); // Oct 2025 … Sep 2026
  MONTHS.push([d.getFullYear(), d.getMonth() + 1]);
}
const cardSpend = Object.fromEntries(CARDS.map((c) => [c, {}])); // card -> month -> cents

for (const [y, m] of MONTHS) {
  const key = `${y}-${pad(m)}`;
  const spend = (card, d, desc, merchant, cents, category) => {
    add(card, day(y, m, d), desc, merchant, -cents, category, 'purchase');
    cardSpend[card][key] = (cardSpend[card][key] ?? 0) + cents;
  };

  // Income: Alex paid every other Friday-ish, Sam twice a month.
  add(A.alexChecking, day(y, m, 1), 'ACME CORP PAYROLL PPD ID: 9000000001', 'Acme Corp', 284000, 'Salary', 'deposit');
  add(A.alexChecking, day(y, m, 15), 'ACME CORP PAYROLL PPD ID: 9000000001', 'Acme Corp', 284000, 'Salary', 'deposit');
  add(A.samChecking, day(y, m, 7), 'NORTHWIND LLC DES:PAYROLL', 'Northwind', 231000, 'Salary', 'deposit');
  add(A.samChecking, day(y, m, 22), 'NORTHWIND LLC DES:PAYROLL', 'Northwind', 231000, 'Salary', 'deposit');
  add(A.alexChecking, day(y, m, 28), 'INTEREST PAYMENT', 'Chase', between(90, 420), 'Interest', 'interest');

  // Housing and bills.
  spend(A.bilt, 1, 'BPS*BILT HOUSING 100 Sample Ave', 'Bilt Housing', 185000, 'Rent');
  spend(A.freedom, 12, 'DUKE ENERGY PAYMENT', 'Duke Energy', between(8200, 16400), 'Utilities');
  spend(A.amex, 18, 'SPECTRUM INTERNET', 'Spectrum', 7999, 'Utilities');
  spend(A.bofaCard, 20, 'ALLSTATE *PAYMENT', 'Allstate', 13200, 'Insurance');
  spend(A.amex, 5, 'NETFLIX.COM', 'Netflix', 1549, 'Subscriptions');
  spend(A.amex, 9, 'SPOTIFY USA', 'Spotify', 1199, 'Subscriptions');
  spend(A.bofaCard, 11, 'DISNEY PLUS', 'Disney+', 999, 'Subscriptions');
  spend(A.freedom, 3, 'APPLE.COM/BILL', 'Apple', 299, 'Subscriptions');
  spend(A.bofaCard, 2, 'PLANET FITNESS', 'Planet Fitness', 2499, 'Health');

  // Everyday spending.
  for (const d of [3, 10, 17, 24]) spend(pick([A.amex, A.bofaCard]), d, "TRADER JOE'S #123", "Trader Joe's", between(4500, 11800), 'Groceries');
  for (const d of [6, 20]) spend(A.amex, d, 'COSTCO WHSE #0123', 'Costco', between(11000, 26000), 'Costco');
  for (let i = 0; i < 9; i++) {
    const [desc, merchant, lo, hi] = pick([
      ['CHIPOTLE 1234', 'Chipotle', 1100, 2800], ['STARBUCKS STORE 55', 'Starbucks', 450, 1400],
      ['SPICE CORNER', 'Spice Corner', 2400, 6800], ['DOORDASH*ORDER', 'DoorDash', 1800, 5200], ['PANERA BREAD', 'Panera Bread', 1200, 3100],
    ]);
    spend(pick([A.freedom, A.bofaCard, A.amex]), between(1, 28), desc, merchant, between(lo, hi), 'Dining');
  }
  for (let i = 0; i < 5; i++) spend(pick([A.freedom, A.amex]), between(1, 28), 'AMAZON.COM*ORDER', 'Amazon', between(1200, 14800), 'Shopping');
  spend(A.bofaCard, between(1, 28), 'TARGET T-1234', 'Target', between(2500, 9800), 'Shopping');
  for (let i = 0; i < 3; i++) spend(A.freedom, between(1, 28), 'TESLA SUPERCHARGER', 'Tesla Supercharger', between(1200, 3100), 'EV Charging');
  spend(A.bofaCard, between(1, 28), 'SHELL OIL 57444', 'Shell', between(3400, 5600), 'Fuel');
  spend(A.freedom, between(1, 28), 'UBER *TRIP', 'Uber', between(1400, 3900), 'Transport');
  if (m % 2 === 0) spend(A.bofaCard, between(1, 28), 'CINEMARK 800-2463627', 'Cinemark', between(1800, 4200), 'Entertainment');
  if (m === 12 || m === 6) {
    spend(A.amex, 10, 'DELTA AIR LINES', 'Delta', between(32000, 46000), 'Travel');
    spend(A.amex, 14, 'MARRIOTT HOTELS', 'Marriott', between(38000, 52000), 'Travel');
  }
  if (m === 3) spend(A.amex, 1, 'ANNUAL MEMBERSHIP FEE', 'American Express', 9500, 'Annual Fee');
  if (m % 3 === 1) add(A.freedom, day(y, m, 19), 'AMAZON.COM REFUND', 'Amazon', between(1500, 4500), 'Refund', 'refund');

  // Cashback, printed on the card statements.
  add(A.amex, day(y, m, 25), 'CASH BACK REWARD CREDIT', 'American Express', between(900, 2600), 'Cashback', 'cashback');
  add(A.bofaCard, day(y, m, 26), 'CASHBACK REDEMPTION', 'Bank of America', between(400, 1500), 'Cashback', 'cashback');

  // Zelle: sent, received, and one between the two of them.
  add(A.alexChecking, day(y, m, 9), 'Zelle Payment To Jordan Lee Jpm99Demo', 'Jordan Lee', -between(2000, 8000), 'Zelle', 'purchase', { zelle_type: 'SENT', zelle_person: 'Jordan Lee', contact_id: FRIENDS['Jordan Lee'] });
  if (m % 2) add(A.samChecking, day(y, m, 13), 'Zelle payment from PRIYA SHAH Conf# demo', 'Priya Shah', between(2500, 6000), 'Zelle', 'deposit', { zelle_type: 'RECEIVED', zelle_person: 'Priya Shah', contact_id: FRIENDS['Priya Shah'] });
  if (m % 4 === 0) add(A.alexChecking, day(y, m, 21), 'Zelle Payment To Diego Alvarez 40271177136', 'Diego Alvarez', -between(4000, 12000), 'Zelle', 'purchase', { zelle_type: 'SENT', zelle_person: 'Diego Alvarez', contact_id: FRIENDS['Diego Alvarez'] });
  add(A.alexChecking, day(y, m, 16), 'Zelle Payment To Sam Rivera Jpm99Demo', 'Sam Rivera', -50000, 'Zelle', 'transfer', { zelle_type: 'INTERNAL', zelle_person: 'Sam Rivera' });
  add(A.samChecking, day(y, m, 16), 'Zelle payment from ALEX MORGAN Conf# demo', 'Alex Morgan', 50000, 'Zelle', 'transfer', { zelle_type: 'INTERNAL', zelle_person: 'Alex Morgan' });

  // Investing and the car loan.
  add(A.alexChecking, day(y, m, 2), 'ROBINHOOD DES:DEBITS INDN:ALEX J MORGAN', 'Robinhood', -50000, 'Investment', 'transfer');
  add(A.alexChecking, day(y, m, 13), 'WELLS FARGO AUTO DRAFT', 'Wells Fargo', -54000, 'Loan', 'payment');
}

// Card bills: each month's card spend, paid from checking early the next month.
for (const card of CARDS) {
  for (const [month, cents] of Object.entries(cardSpend[card])) {
    const [y, m] = month.split('-').map(Number);
    const payDate = day(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 5);
    if (payDate > '2026-09-30') continue;
    add(card, payDate, 'PAYMENT - THANK YOU', null, cents, 'Card Payment', 'payment');
    add(CHECKING_OF[card], payDate, 'CARD PAYMENT', null, -cents, 'Card Payment', 'payment');
  }
}

let n = 0;
for (const t of txns) {
  const hash = createHash('sha256').update(`${t.accountId}|${t.date}|${t.description}|${t.cents}|${n++}`).digest('hex');
  await q(
    `INSERT INTO transaction (account_id, posted_date, description, merchant, amount_cents, category_id, txn_type, dedupe_hash, zelle_type, zelle_person, contact_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [t.accountId, t.date, t.description, t.merchant, t.cents, cat[t.category] ?? null, t.type, hash, t.zelle_type ?? null, t.zelle_person ?? null, t.contact_id ?? null],
  );
}

// ---- Statements: one per account per month; Bilt's last one left missing ----
for (const card of [...CARDS, A.alexChecking, A.samChecking]) {
  for (const [y, m] of MONTHS) {
    if (card === A.bilt && y === 2026 && m === 9) continue; // shows as "Missing" on the Cards calendar
    const start = day(y, m, 1);
    const end = day(y, m, 31);
    const { rows } = await q(
      `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE txn_type = 'purchase'), 0)::int AS spend,
              COALESCE(SUM(amount_cents) FILTER (WHERE txn_type = 'payment'), 0)::int AS paid,
              COALESCE(SUM(amount_cents) FILTER (WHERE txn_type = 'cashback'), 0)::int AS cashback
         FROM transaction WHERE account_id = $1 AND posted_date BETWEEN $2 AND $3`,
      [card, start, end],
    );
    const r = rows[0];
    await q(
      `INSERT INTO statement (account_id, period_start, period_end, total_spend_cents, total_payments_cents, cashback_earned_cents, opening_balance_cents, closing_balance_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [card, start, end, r.spend, r.paid, r.cashback || null, -r.paid, r.spend],
    );
  }
}

// ---- Loans ---------------------------------------------------------------
await q(
  `INSERT INTO loan (name, lender, linked_account_id, term_months, start_date, current_balance_cents, deadline_date, monthly_payment_cents, loan_type)
   VALUES ('Model 3', 'Wells Fargo', $1, 60, '2024-04-13', 1890000, '2029-04-13', 54000, 'car'),
          ('0% balance transfer', 'Bank of America', $2, NULL, '2026-03-01', 420000, '2027-03-01', NULL, 'balance_transfer')`,
  [A.alexChecking, A.bofaCard],
);

await q(`INSERT INTO app_setting (key, value) VALUES ('overview_cards', '["cashback_interest", "fee_interest", "investment", "zelle"]')`);

console.log(`seed: 2 people, ${Object.keys(A).length} accounts, ${txns.length} transactions, ${(CARDS.length + 2) * 12 - 1} statements, 2 loans`);
await db.end();
