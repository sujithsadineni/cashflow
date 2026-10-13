/**
 * The Overview summary, assembled from its query results (D220). Pure:
 * results in, response out, no database, so it can be tested on its own.
 * Moved out of routes/summary.js unchanged.
 *
 * @param month   'YYYY-MM'
 * @param results { totals, byCategory, ... } as runSummaryQueries returns them
 */
export function assembleSummary(month, results) {
  const {
    totals, byCategory, byPerson, salaryLines, otherIncome, incomeByMonth,
    spendByMonth, spendByPersonCategory, largest, cashback, secondaryByMonth,
    secondaryByAccountTxn, secondaryByAccountStatement, feeInterestTransactions, loans,
    zelleSent,
  } = results;

  // Savings is derived, not queried: income minus spend minus real
  // debt repayment, for the same month/previous-month/year-to-date
  // triplet the other cards use. Everything on the right is already
  // correctly signed (income positive, spend and loan_payment_cents
  // negative — D18/above), so this is a plain sum, no new SQL. This
  // replaces the old SAVINGS-account / txn_type='savings' tracking
  // (D28/D39/D40) entirely, per the household's own call: those were
  // manual, easy-to-forget tags, and this way Savings updates the
  // moment a statement is uploaded or a transaction recategorized,
  // with no separate bookkeeping step. Deliberately a single
  // household-wide figure, not split by person or account.
  const t = totals.rows[0];
  const currentSavingsCents =
    Number(t.current_income_cents) + Number(t.current_spend_cents) + Number(t.current_loan_payment_cents);
  const previousSavingsCents =
    Number(t.previous_income_cents) + Number(t.previous_spend_cents) + Number(t.previous_loan_payment_cents);
  const yearToDateSavingsCents =
    Number(t.year_to_date_income_cents) + Number(t.year_to_date_spend_cents) + Number(t.year_to_date_loan_payment_cents);

  // Same derivation, per month, for the Savings dialog's trend —
  // zipped from income_by_month and spend_by_month rather than a
  // third generate_series query, since both already walk the same
  // Jan-through-selected-month range in the same order.
  const savingsByMonth = incomeByMonth.rows.map((im, i) => {
    const sm = spendByMonth.rows[i];
    return {
      month: im.month,
      savings_cents: Number(im.income_cents) + Number(sm.spend_cents) + Number(sm.loan_payment_cents),
    };
  });

  // Four secondary cards, two of them combined pairs — Interest
  // Earned/Charged are both too small on their own to earn a full
  // card (a few dollars either way), so Interest Earned folds into
  // Cashback ("money coming back") and Interest Charged folds into
  // Fees ("money leaving that isn't spending on anything"),
  // household's own call once five cards stopped fitting cleanly.
  // Cashback itself is already three sources — the issuer's own
  // printed reward plus two hand-confirmed transaction tiers (see
  // the comments on those queries above for why each exists and
  // why they don't double-count) — the combined card just adds a
  // fourth on top; the detail dialog still lists each named source
  // separately underneath the one combined headline.
  const cb = cashback.rows[0];
  const cashbackCurrent =
    Number(cb.current_statement_cashback_cents) + Number(t.current_cashback_type_cents) + Number(t.current_statement_credit_cents);
  const cashbackPrevious =
    Number(cb.previous_statement_cashback_cents) + Number(t.previous_cashback_type_cents) + Number(t.previous_statement_credit_cents);
  const cashbackYearToDate =
    Number(cb.year_to_date_statement_cashback_cents) + Number(t.year_to_date_cashback_type_cents) + Number(t.year_to_date_statement_credit_cents);

  const cashbackInterestCurrent = cashbackCurrent + Number(t.current_interest_earned_cents);
  const cashbackInterestPrevious = cashbackPrevious + Number(t.previous_interest_earned_cents);
  const cashbackInterestYearToDate = cashbackYearToDate + Number(t.year_to_date_interest_earned_cents);

  const feeInterestCurrent = Number(t.current_fee_cents) + Number(t.current_interest_charged_cents);
  const feeInterestPrevious = Number(t.previous_fee_cents) + Number(t.previous_interest_charged_cents);
  const feeInterestYearToDate = Number(t.year_to_date_fee_cents) + Number(t.year_to_date_interest_charged_cents);

  const secondaryByMonthRows = secondaryByMonth.rows.map((r) => {
    const cashbackCents = Number(r.statement_cashback_cents) + Number(r.cashback_type_cents) + Number(r.statement_credit_cents);
    return {
      month: r.month,
      cashback_interest_cents: cashbackCents + Number(r.interest_earned_cents),
      fee_interest_cents: Number(r.fee_cents) + Number(r.interest_charged_cents),
      india_transfer_cents: Number(r.india_transfer_cents),
      investment_cents: Number(r.investment_cents),
    };
  });

  // Same figures, by account instead of by month — merging the
  // transaction-side query with the statement-cashback one (they
  // don't share every account, hence a Map keyed by account_id
  // rather than a straight zip). Dropped once every figure for that
  // account is zero, so a household with two dozen accounts doesn't
  // get two dozen empty rows in each dialog's "By account" list.
  const byAccount = new Map();
  for (const r of secondaryByAccountTxn.rows) {
    byAccount.set(r.account_id, {
      account_id: r.account_id,
      account_name: r.account_name,
      cashback_interest_cents: Number(r.cashback_type_cents) + Number(r.statement_credit_cents) + Number(r.interest_earned_cents),
      fee_interest_cents: Number(r.fee_cents) + Number(r.interest_charged_cents),
      india_transfer_cents: Number(r.india_transfer_cents),
      investment_cents: Number(r.investment_cents),
    });
  }
  for (const r of secondaryByAccountStatement.rows) {
    const existing = byAccount.get(r.account_id) ?? {
      account_id: r.account_id,
      account_name: r.account_name,
      cashback_interest_cents: 0,
      fee_interest_cents: 0,
      india_transfer_cents: 0,
      investment_cents: 0,
    };
    existing.cashback_interest_cents += Number(r.statement_cashback_cents);
    byAccount.set(r.account_id, existing);
  }
  const secondaryByAccountRows = [...byAccount.values()].filter(
    (r) => r.cashback_interest_cents || r.fee_interest_cents || r.india_transfer_cents || r.investment_cents
  );


  return {
    month,
    spend: totals.rows[0],
    by_category: byCategory.rows,
    by_person: byPerson.rows,
    salary_lines: salaryLines.rows,
    other_income: otherIncome.rows,
    income_by_month: incomeByMonth.rows,
    spend_by_month: spendByMonth.rows,
    spend_by_person_category: spendByPersonCategory.rows,
    zelle_sent: zelleSent.rows,
    largest: largest.rows,
    savings: {
      current_savings_cents: currentSavingsCents,
      previous_savings_cents: previousSavingsCents,
      year_to_date_savings_cents: yearToDateSavingsCents,
    },
    savings_by_month: savingsByMonth,
    loans: loans.rows[0],
    secondary: {
      cashback_interest: {
        current_cents: cashbackInterestCurrent,
        previous_cents: cashbackInterestPrevious,
        year_to_date_cents: cashbackInterestYearToDate,
        current_breakdown: {
          cashback_cents: Number(cb.current_statement_cashback_cents) + Number(t.current_cashback_type_cents),
          statement_credit_cents: Number(t.current_statement_credit_cents),
          interest_earned_cents: Number(t.current_interest_earned_cents),
        },
        year_to_date_breakdown: {
          cashback_cents: Number(cb.year_to_date_statement_cashback_cents) + Number(t.year_to_date_cashback_type_cents),
          statement_credit_cents: Number(t.year_to_date_statement_credit_cents),
          interest_earned_cents: Number(t.year_to_date_interest_earned_cents),
        },
      },
      fee_interest: {
        current_cents: feeInterestCurrent,
        previous_cents: feeInterestPrevious,
        year_to_date_cents: feeInterestYearToDate,
        current_breakdown: {
          fee_cents: Number(t.current_fee_cents),
          interest_charged_cents: Number(t.current_interest_charged_cents),
        },
        year_to_date_breakdown: {
          fee_cents: Number(t.year_to_date_fee_cents),
          interest_charged_cents: Number(t.year_to_date_interest_charged_cents),
        },
        transactions: feeInterestTransactions.rows.map((r) => ({
          id: r.id,
          posted_date: r.posted_date,
          amount_cents: Number(r.amount_cents),
          txn_type: r.txn_type,
          merchant: r.merchant,
          description: r.description,
          account_name: r.account_name,
        })),
      },
      india_transfer: {
        current_cents: Number(t.current_india_transfer_cents),
        previous_cents: Number(t.previous_india_transfer_cents),
        year_to_date_cents: Number(t.year_to_date_india_transfer_cents),
      },
      investment: {
        current_cents: Number(t.current_investment_cents),
        previous_cents: Number(t.previous_investment_cents),
        year_to_date_cents: Number(t.year_to_date_investment_cents),
      },
    },
    secondary_by_month: secondaryByMonthRows,
    secondary_by_account: secondaryByAccountRows,
  };
}
