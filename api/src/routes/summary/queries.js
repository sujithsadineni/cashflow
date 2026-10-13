/**
 * The Overview summary's queries (D220), one named function each, all
 * taking the selected month's first day. Moved out of routes/summary.js
 * unchanged; assemble.js turns their results into the response.
 */

import { query } from '../../db.js';
import { effectiveBalanceSql, monthEndCappedSql } from '../loans.js';
import { spendSql } from '../../spend.js';

// The last day of the selected month ($1, a month-start date), capped
// at today — shared with routes/loans.js's own `?month=` support
// (LoansDetail.jsx's drill-down) so "as of this month" is one formula,
// not two that could drift.
const LOAN_AS_OF_SQL = monthEndCappedSql('$1');

export const SUMMARY_QUERIES = {
  totals: (start) => query(
    `SELECT
       COALESCE(LEAST(SUM(amount_cents) FILTER (
         WHERE posted_date >= $1::date
           AND posted_date < $1::date + interval '1 month'
           AND (${spendSql('')})), 0), 0) AS current_spend_cents,
       COALESCE(LEAST(SUM(amount_cents) FILTER (
         WHERE posted_date >= $1::date - interval '1 month'
           AND posted_date < $1::date
           AND (${spendSql('')})), 0), 0) AS previous_spend_cents,
       -- Income is every deposit — salary, a tax refund, an
       -- unlabeled cash deposit, whatever else lands as new money
       -- in. Deliberately NOT "any positive amount": that used to
       -- also count a merchandise refund as income, which is
       -- really just Spend reversing (D37 already nets it there;
       -- counting it again here would double it). txn_type =
       -- 'deposit' is a real, narrower fact than "amount > 0".
       COALESCE(SUM(amount_cents) FILTER (
         WHERE posted_date >= $1::date
           AND posted_date < $1::date + interval '1 month'
           AND txn_type = 'deposit'), 0) AS current_income_cents,
       COALESCE(SUM(amount_cents) FILTER (
         WHERE posted_date >= $1::date - interval '1 month'
           AND posted_date < $1::date
           AND txn_type = 'deposit'), 0) AS previous_income_cents,
       -- Salary is the subset of income that's actually
       -- categorized Salary — used for the per-person breakdown
       -- inside the Income dialog, not the card's own headline
       -- number (which is every deposit, per above).
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Salary'), 0) AS current_salary_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND c.name = 'Salary'), 0) AS previous_salary_cents,
       -- Cumulative income for the selected month's calendar
       -- year, through the end of that month — the Income
       -- dialog's "so far this year" line, same idea as the
       -- Savings card's year view (D46) but as one running total
       -- rather than a full year browser, since that's what was
       -- actually asked for.
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'deposit'), 0) AS year_to_date_income_cents,
       -- Same idea, Spend side: cumulative for the calendar year
       -- through the end of the selected month, clamped once over
       -- the whole range (not month-by-month) so a heavy-refund
       -- month elsewhere in the year can't make this go positive.
       COALESCE(LEAST(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND (${spendSql('t')})), 0), 0) AS year_to_date_spend_cents,
       -- Real debt repayment — a transaction actually categorized
       -- Loan, the same category already on the household's real
       -- Wells Fargo payments. Deliberately not every 'payment'
       -- row: a regular credit card bill (category 'Card Payment')
       -- is settling a purchase already counted in Spend above,
       -- so subtracting it again here would double-count it. Loan
       -- payments were never counted in Spend at all (D18 excludes
       -- txn_type='payment' outright), so this is the one place
       -- they get counted — as money that isn't available to save,
       -- not as ordinary spending.
       --
       -- Also restricted to txn_type = 'payment' now, not every
       -- 'Loan'-categorized row regardless of type — a real gap
       -- found once a second loan (a BofA balance-transfer card)
       -- started sharing its category with things that AREN'T a
       -- payment: the transfer that draws the balance-transfer
       -- cash in (positive, would have inflated Savings as if it
       -- were a payment received) and the transfer fee (already
       -- counted in Spend, since 'fee' isn't in D18's exclusion
       -- list — counting it again here would double-subtract it).
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Loan' AND t.txn_type = 'payment'), 0) AS current_loan_payment_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND c.name = 'Loan' AND t.txn_type = 'payment'), 0) AS previous_loan_payment_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Loan' AND t.txn_type = 'payment'), 0) AS year_to_date_loan_payment_cents,
       -- Interest earned/charged: real 'interest'-typed rows,
       -- split by sign since the type itself doesn't say which
       -- direction (a savings account paying interest in, a
       -- card charging interest out, use the same enum value —
       -- the amount's own sign is the only signal there is).
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'interest' AND t.amount_cents > 0), 0) AS current_interest_earned_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND t.txn_type = 'interest' AND t.amount_cents > 0), 0) AS previous_interest_earned_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'interest' AND t.amount_cents > 0), 0) AS year_to_date_interest_earned_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'interest' AND t.amount_cents < 0), 0) AS current_interest_charged_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND t.txn_type = 'interest' AND t.amount_cents < 0), 0) AS previous_interest_charged_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'interest' AND t.amount_cents < 0), 0) AS year_to_date_interest_charged_cents,
       -- Fees: every txn_type='fee' row, regardless of category —
       -- a balance-transfer fee (category 'Loan'), a card's own
       -- annual fee (category 'Annual Fee'), a late fee (however
       -- it got categorized) are all the same kind of household
       -- fact: a fee, not spending on anything. Category-agnostic
       -- on purpose, so a new fee type never needs its own new
       -- card or a code change to show up here — real data has
       -- already shown three different categories for a fee.
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'fee'), 0) AS current_fee_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND t.txn_type = 'fee'), 0) AS previous_fee_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'fee'), 0) AS year_to_date_fee_cents,
       -- Transfers to India: a real, hand-confirmed category (the
       -- household categorizes these by hand off real remittance
       -- transactions — Frex, Tribe — the same manual-review
       -- discipline as every other category here), not a
       -- txn_type of its own. Kept as 'transfer' at the type
       -- level (it already was, from the parser, and it's a
       -- transfer out to a third party, not a purchase) so it
       -- stays excluded from Spend exactly like it was before
       -- this category existed — this card tracks it
       -- independently, the same relationship Fees has to Spend
       -- being the one exception, not the rule.
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Transfer to India'), 0) AS current_india_transfer_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND c.name = 'Transfer to India'), 0) AS previous_india_transfer_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Transfer to India'), 0) AS year_to_date_india_transfer_cents,
       -- Same shape as India transfers — one category, summed
       -- independently, excluded from Spend by txn_type (D128's
       -- rule sets 'transfer' for every real Investment row, the
       -- same exclusion Card Payment and Transfer already get).
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Investment'), 0) AS current_investment_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND c.name = 'Investment'), 0) AS previous_investment_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Investment'), 0) AS year_to_date_investment_cents,
       -- Cashback, transaction side — two tiers, both hand-
       -- confirmed real money back, never estimated from a
       -- purchase's own category (the issuer's own printed
       -- cashback reward is handled separately, off the
       -- statement — see the cashback query below, unchanged
       -- from before). 'cashback' is a direct payout/credit
       -- already typed as such; the Cashback CATEGORY beyond
       -- that catches a retailer statement credit (a Disney+ or
       -- Food Lion promo) that posts as an ordinary refund or
       -- deposit but gets hand-recategorized to Cashback once
       -- confirmed real — excluding the cashback-typed rows here
       -- keeps the two tiers from double-counting each other.
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'cashback'), 0) AS current_cashback_type_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND t.txn_type = 'cashback'), 0) AS previous_cashback_type_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND t.txn_type = 'cashback'), 0) AS year_to_date_cashback_type_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Cashback' AND t.txn_type != 'cashback'), 0) AS current_statement_credit_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= $1::date - interval '1 month'
           AND t.posted_date < $1::date
           AND c.name = 'Cashback' AND t.txn_type != 'cashback'), 0) AS previous_statement_credit_cents,
       COALESCE(SUM(t.amount_cents) FILTER (
         WHERE t.posted_date >= date_trunc('year', $1::date)
           AND t.posted_date < $1::date + interval '1 month'
           AND c.name = 'Cashback' AND t.txn_type != 'cashback'), 0) AS year_to_date_statement_credit_cents
     FROM transaction t
     LEFT JOIN category c ON c.id = t.category_id`,
    [start]
  ),
  byCategory: (start) => query(
    `SELECT t.category_id, COALESCE(c.name, 'Uncategorized') AS name,
            LEAST(SUM(t.amount_cents), 0) AS spend_cents
       FROM transaction t
       LEFT JOIN category c ON c.id = t.category_id
      WHERE (${spendSql('t')})
        AND t.posted_date >= $1::date
        AND t.posted_date < $1::date + interval '1 month'
      GROUP BY t.category_id, c.name
     HAVING LEAST(SUM(t.amount_cents), 0) < 0
      ORDER BY SUM(t.amount_cents) ASC`,
    [start]
  ),
  // Person-driven (LEFT JOIN, not INNER) so both people always
  // appear even in a month with zero salary or zero spend — the
  // Salary/Spent cards' per-person dialogs need a row for each
  // person, not just whoever happened to have activity.
  //
  // net_cents is deliberately NOT clamped at 0 the way the
  // household Spend total is (D37): the household total clamping
  // makes sense because "spent negative dollars" isn't a real
  // concept, but clamping PER PERSON hid a real bug — a real
  // September where one person had actual Groceries/Subscriptions
  // purchases, plus an unrelated $154 Allstate refund bigger than
  // both combined, rendered as a flat "$0.00" with no sign of the
  // real spending underneath it. The sign itself is useful here:
  // a person can genuinely go net positive in a month (a big
  // refund/credit outweighing what they bought), and the UI
  // should say so, not hide it behind a floor.
  byPerson: (start) => query(
    `SELECT p.id, p.name,
            COALESCE(SUM(t.amount_cents) FILTER (
              WHERE t.posted_date >= $1::date
                AND t.posted_date < $1::date + interval '1 month'
                AND (${spendSql('t')})), 0) AS net_cents,
            COALESCE(SUM(t.amount_cents) FILTER (
              WHERE t.posted_date >= $1::date
                AND t.posted_date < $1::date + interval '1 month'
                AND c.name = 'Salary'), 0) AS salary_cents
       FROM person p
       LEFT JOIN account a ON a.person_id = p.id
       LEFT JOIN transaction t ON t.account_id = a.id
       LEFT JOIN category c ON c.id = t.category_id
      GROUP BY p.id, p.name
      ORDER BY p.name`,
    [start]
  ),
  // The itemized lines behind each person's salary figure — so
  // "how did you get $5,420.00" is answerable by looking, not by
  // trusting a black-box sum. Naturally shows one person's two
  // paychecks a month next to the other's one, since it's just the
  // real rows, not a computed count.
  salaryLines: (start) => query(
    `SELECT t.id, p.id AS person_id, t.posted_date, t.merchant, t.amount_cents
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       JOIN person p ON p.id = a.person_id
       JOIN category c ON c.id = t.category_id AND c.name = 'Salary'
      WHERE t.posted_date >= $1::date
        AND t.posted_date < $1::date + interval '1 month'
      ORDER BY p.name, t.posted_date`,
    [start]
  ),
  // The rest of the Income total that isn't Salary — a tax refund,
  // a plain cash deposit, whatever else. A normal, itemized part
  // of "where did the money come from," not a warning: shown in
  // its own section of the Income dialog next to the Salary one.
  otherIncome: (start) => query(
    `SELECT t.id, p.id AS person_id, t.posted_date, t.description, t.merchant,
            t.amount_cents, t.contact_id,
            ct.name AS contact_name, ct.nickname AS contact_nickname, ct.image_path AS contact_image_path,
            -- A reviewed Zelle receipt has no category (nothing to
            -- categorize — it's a payment from a person, not a
            -- purchase) and would otherwise read as "Uncategorized"
            -- right next to real income. The contact's name is
            -- exactly who it's from, already hand-confirmed — see
            -- routes/zelle.js — and stays live: renaming the
            -- contact here updates this label with no write to
            -- the transaction itself.
            CASE
              WHEN t.description ILIKE '%zelle%' AND ct.id IS NOT NULL
                THEN 'Zelle from ' || COALESCE(ct.nickname, ct.name)
              WHEN t.description ILIKE '%zelle%' AND t.zelle_person IS NOT NULL
                THEN 'Zelle from ' || t.zelle_person
              ELSE COALESCE(c.name, 'Uncategorized')
            END AS category_name
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       JOIN person p ON p.id = a.person_id
       LEFT JOIN category c ON c.id = t.category_id
       LEFT JOIN contact ct ON ct.id = t.contact_id
      WHERE t.posted_date >= $1::date
        AND t.posted_date < $1::date + interval '1 month'
        AND t.txn_type = 'deposit'
        AND COALESCE(c.name, '') != 'Salary'
      ORDER BY t.posted_date`,
    [start]
  ),
  // January through the selected month, real per-month income —
  // the shape behind the Income dialog's "so far this year" mini
  // trend, not synthetic bars. generate_series fills in a quiet
  // month as zero instead of dropping it, same pattern as the
  // transactions trends endpoint.
  incomeByMonth: (start) => query(
    `SELECT to_char(b.bucket, 'YYYY-MM') AS month,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'deposit'), 0) AS income_cents
       FROM generate_series(date_trunc('year', $1::date), $1::date, interval '1 month') AS b(bucket)
       LEFT JOIN transaction t ON date_trunc('month', t.posted_date) = b.bucket
      GROUP BY b.bucket
      ORDER BY b.bucket`,
    [start]
  ),
  // Same shape as income_by_month, Spend side — real per-month
  // totals for the Spend dialog's own "so far this year" trend.
  // Each month clamped individually (LEAST), matching how the
  // monthly Spend figure already works, so a heavy-refund month
  // shows as $0 rather than negative-spend nonsense. Also carries
  // loan_payment_cents per month (category = 'Loan' AND txn_type
  // = 'payment' — see the comment on the totals query above for
  // why the type filter matters now) — computed here rather than
  // a fourth query, since it needs the exact same generate_series
  // scaffold; Savings' own month-by-month trend is built from
  // this plus income_by_month, in JS below.
  spendByMonth: (start) => query(
    `SELECT to_char(b.bucket, 'YYYY-MM') AS month,
            COALESCE(LEAST(SUM(t.amount_cents) FILTER (
              WHERE ${spendSql('t')}), 0), 0) AS spend_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Loan' AND t.txn_type = 'payment'), 0) AS loan_payment_cents
       FROM generate_series(date_trunc('year', $1::date), $1::date, interval '1 month') AS b(bucket)
       LEFT JOIN transaction t ON date_trunc('month', t.posted_date) = b.bucket
       LEFT JOIN category c ON c.id = t.category_id
      GROUP BY b.bucket
      ORDER BY b.bucket`,
    [start]
  ),
  // Top 3 categories per person this month — a cut nowhere else in
  // the app shows (the main "Where it's going" bars are household-
  // wide). ROW_NUMBER, not LIMIT, because it's per-person top-N in
  // one query rather than one query per person.
  spendByPersonCategory: (start) => query(
    `SELECT person_id, name, category_name, spend_cents
       FROM (
         SELECT p.id AS person_id, p.name,
                COALESCE(c.name, 'Uncategorized') AS category_name,
                LEAST(SUM(t.amount_cents), 0) AS spend_cents,
                ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY SUM(t.amount_cents) ASC) AS rn
           FROM transaction t
           JOIN account a ON a.id = t.account_id
           JOIN person p ON p.id = a.person_id
           LEFT JOIN category c ON c.id = t.category_id
          WHERE (${spendSql('t')})
            AND t.posted_date >= $1::date
            AND t.posted_date < $1::date + interval '1 month'
          GROUP BY p.id, p.name, c.name
       ) ranked
      WHERE rn <= 3 AND spend_cents < 0
      ORDER BY name, spend_cents ASC`,
    [start]
  ),
  largest: (start) => query(
    `SELECT t.id, t.posted_date, t.description, t.merchant, t.amount_cents,
            c.name AS category_name, c.icon_key AS category_icon_key, a.name AS account_name
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN category c ON c.id = t.category_id
      WHERE t.amount_cents < 0
        AND COALESCE(t.txn_type,'') NOT IN ('payment','transfer','savings')
        AND t.posted_date >= $1::date
        AND t.posted_date < $1::date + interval '1 month'
      ORDER BY t.amount_cents ASC
      LIMIT 5`,
    [start]
  ),
  // The issuer's own printed cashback reward — unchanged rule
  // from before (D-whatever originally added it): read off the
  // statement, never calculated. Now carries previous/YTD too,
  // matching every other card's triplet, so it can combine with
  // the transaction-side tiers above into one "Cashback" figure.
  cashback: (start) => query(
    `SELECT
       COALESCE(SUM(cashback_earned_cents) FILTER (
         WHERE period_end >= $1::date AND period_end < $1::date + interval '1 month'), 0) AS current_statement_cashback_cents,
       COALESCE(SUM(cashback_earned_cents) FILTER (
         WHERE period_end >= $1::date - interval '1 month' AND period_end < $1::date), 0) AS previous_statement_cashback_cents,
       COALESCE(SUM(cashback_earned_cents) FILTER (
         WHERE period_end >= date_trunc('year', $1::date) AND period_end < $1::date + interval '1 month'), 0) AS year_to_date_statement_cashback_cents
     FROM statement`,
    [start]
  ),
  // Month-by-month trend for the four new secondary cards' detail
  // dialogs — same generate_series scaffold as income/spend_by_
  // month, just carrying different FILTER'd sums. The statement-
  // side cashback component needs its own LATERAL join since it
  // comes from a different table on a different date column
  // (period_end, not posted_date); MAX() pulls that one row per
  // bucket through the GROUP BY the transaction join otherwise
  // forces.
  secondaryByMonth: (start) => query(
    `SELECT to_char(b.bucket, 'YYYY-MM') AS month,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'interest' AND t.amount_cents > 0), 0) AS interest_earned_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'interest' AND t.amount_cents < 0), 0) AS interest_charged_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'fee'), 0) AS fee_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Transfer to India'), 0) AS india_transfer_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Investment'), 0) AS investment_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'cashback'), 0) AS cashback_type_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Cashback' AND t.txn_type != 'cashback'), 0) AS statement_credit_cents,
            COALESCE(MAX(st.cashback_cents), 0) AS statement_cashback_cents
       FROM generate_series(date_trunc('year', $1::date), $1::date, interval '1 month') AS b(bucket)
       LEFT JOIN transaction t ON date_trunc('month', t.posted_date) = b.bucket
       LEFT JOIN category c ON c.id = t.category_id
       LEFT JOIN LATERAL (
         SELECT SUM(cashback_earned_cents) AS cashback_cents
           FROM statement
          WHERE date_trunc('month', period_end) = b.bucket
       ) st ON true
      GROUP BY b.bucket
      ORDER BY b.bucket`,
    [start]
  ),
  // Same four secondary figures, grouped by account instead of by
  // month — "which card" alongside "which month" for the detail
  // dialogs. Year-to-date only (no current/previous split here;
  // the by-month list already covers recency, this covers source).
  // Only transaction-typed rows; the statement-side cashback
  // component is a separate query below since it comes off a
  // different table.
  secondaryByAccountTxn: (start) => query(
    `SELECT a.id AS account_id, a.name AS account_name,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'interest' AND t.amount_cents > 0), 0) AS interest_earned_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'interest' AND t.amount_cents < 0), 0) AS interest_charged_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'fee'), 0) AS fee_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Transfer to India'), 0) AS india_transfer_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Investment'), 0) AS investment_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.txn_type = 'cashback'), 0) AS cashback_type_cents,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE c.name = 'Cashback' AND t.txn_type != 'cashback'), 0) AS statement_credit_cents
       FROM transaction t
       JOIN account a ON a.id = t.account_id
       LEFT JOIN category c ON c.id = t.category_id
      WHERE t.posted_date >= date_trunc('year', $1::date)
        AND t.posted_date < $1::date + interval '1 month'
        AND (t.txn_type IN ('interest', 'fee', 'cashback') OR c.name IN ('Cashback', 'Transfer to India', 'Investment'))
      GROUP BY a.id, a.name`,
    [start]
  ),
  secondaryByAccountStatement: (start) => query(
    `SELECT s.account_id, a.name AS account_name,
            SUM(s.cashback_earned_cents) AS statement_cashback_cents
       FROM statement s
       JOIN account a ON a.id = s.account_id
      WHERE s.period_end >= date_trunc('year', $1::date)
        AND s.period_end < $1::date + interval '1 month'
      GROUP BY s.account_id, a.name`,
    [start]
  ),
  // Itemized real rows behind the combined "Fees & Interest" card
  // — asked for directly ("show the detail, very detailed, where
  // the amount came from"). Real data only ever produces a
  // handful of these (three fees, a few nonzero interest-charged
  // lines — most "INTEREST CHARGED ON X" rows are $0.00 and
  // excluded), so a real line-by-line list is genuinely readable
  // here, unlike the other cards where a monthly/by-account
  // rollup is already plenty. Year-to-date, newest first.
  feeInterestTransactions: (start) => query(
    `SELECT t.id, t.posted_date, t.amount_cents, t.txn_type, t.merchant, t.description,
            a.name AS account_name
       FROM transaction t
       JOIN account a ON a.id = t.account_id
      WHERE t.posted_date >= date_trunc('year', $1::date)
        AND t.posted_date < $1::date + interval '1 month'
        AND t.amount_cents != 0
        AND (t.txn_type = 'fee' OR (t.txn_type = 'interest' AND t.amount_cents < 0))
      ORDER BY t.posted_date DESC`,
    [start]
  ),
  // Loans, as of the SELECTED month, not always "right now" — a
  // balance is still a point-in-time fact, but the point in time
  // is now the month being viewed, capped at today (never a
  // future projection — that's forecasting, out of scope). A loan
  // that hadn't started yet by that month is excluded entirely
  // (loan_count says so, so the card can show "No loans" instead
  // of a misleading $0), not just given a $0 balance. Same three-
  // source logic as routes/loans.js's own list — see
  // effectiveBalanceSql there — just asked "as of" a different
  // date than CURRENT_DATE.
  loans: (start) => query(
    `SELECT COALESCE(SUM(${effectiveBalanceSql(LOAN_AS_OF_SQL)}), 0) AS total_owed_cents,
            MIN(deadline_date) AS nearest_deadline,
            COALESCE(array_agg(DISTINCT loan_type), '{}') AS loan_types,
            COUNT(*) AS loan_count
       FROM loan
      WHERE is_active = true
        AND (start_date IS NULL OR start_date <= ${LOAN_AS_OF_SQL})`,
    [start]
  ),
  // The Spend dialog's mirror of the Income dialog's "Other
  // income" Zelle section (D51/D54) — itemized Zelle payments
  // *sent* this month, same label shape ("Zelle to X" instead of
  // "Zelle from X"), same contact-name-stays-live behavior. These
  // rows are already inside the Spent total above (txn_type is
  // 'purchase' for a real Zelle send, not a separate bucket) —
  // this only adds a breakdown, it doesn't change what "Spent"
  // means.
  zelleSent: (start) => query(
    `SELECT t.id, t.posted_date, t.amount_cents, t.contact_id,
            ct.name AS contact_name, ct.nickname AS contact_nickname, ct.image_path AS contact_image_path,
            CASE
              WHEN ct.id IS NOT NULL THEN 'Zelle to ' || COALESCE(ct.nickname, ct.name)
              WHEN t.zelle_person IS NOT NULL THEN 'Zelle to ' || t.zelle_person
              ELSE 'Zelle payment sent'
            END AS label
       FROM transaction t
       LEFT JOIN contact ct ON ct.id = t.contact_id
      WHERE t.posted_date >= $1::date
        AND t.posted_date < $1::date + interval '1 month'
        AND t.amount_cents < 0
        AND t.description ILIKE '%zelle%'
      ORDER BY t.posted_date`,
    [start]
  ),
};

/** Every query in parallel; resolves to { totals, byCategory, ... } with each pg result. */
export async function runSummaryQueries(start) {
  const entries = Object.entries(SUMMARY_QUERIES);
  const results = await Promise.all(entries.map(([, run]) => run(start)));
  return Object.fromEntries(entries.map(([name], i) => [name, results[i]]));
}
