import { useState } from 'react';
import { useApi } from '../../hooks/use-api';
import { api, formatMoney } from '../../api';
import { MonthPicker } from '../ui/MonthPicker';
import { SavingsDetail } from './details/SavingsDetail';
import { IncomeDetail } from './details/IncomeDetail';
import { SpendDetail } from './details/SpendDetail';
import { LoansDetail } from '../loans/LoansDetail';
import { CashbackDetail } from './details/CashbackDetail';
import { FeesDetail } from './details/FeesDetail';
import { FlowDetail } from './details/FlowDetail';
import { ZelleDetail } from './details/ZelleDetail';
import { LoanTypeIcon } from '../loans/LoanIcons';
import { LOAN_TYPE_LABEL } from '../../lib/loans/loan-types';
import { Segmented, PageTitle } from '../ui/Form';
import {
  IncomeIcon, SpentIcon, LoansIcon, SavingsIcon, CashbackIcon, FeeIcon, CreditIcon,
  TransferOutIcon, PersonTransferIcon, InvestmentIcon,
} from '../cards/CardIcons';
import { OVERVIEW_CARDS } from '../../lib/app/overview-cards';
import { useOverviewCards } from '../../hooks/use-overview-cards';
import { useOverviewSections } from '../../hooks/use-overview-sections';
import { useOverviewLayout } from '../../hooks/use-overview-layout';
import { useWide } from '../../hooks/use-wide';
import { useOverviewView } from '../../hooks/use-overview-view';
import { currentMonth, monthLong, addMonths, fromISO } from '../../lib/app/dates';
import { spendDriver } from '../../lib/overview/spend-driver';
import { WhereItsGoing } from './where/WhereItsGoing';
import { CreditDetail } from './details/CreditDetail';
import { householdUtilisation } from '../../lib/cards/utilisation';
import { PageSkeleton } from '../ui/Loading';
import { SummaryCard } from './SummaryCard';
import { ActivitySection } from './ActivitySection';
import { ByPersonSection, LargestSection } from './OverviewSections';

/**
 * "How did this month go?" at a glance: four cards (Income, Spent, Loans,
 * Savings), a row of smaller ones the household switches on in Settings,
 * where the money went, then (when switched on in Settings) spending by
 * person, the largest transactions and the Activity chart. Each card opens its detail. Month or year to date.
 *
 * Colour discipline: spend and earn mean money out and money in; a card
 * with nothing in it (zero, or a dash) is ink, not either (D311).
 */

const monthLabel = monthLong;

// "Jan–Sep 2026" — the caption every card switches to in YTD mode,
// replacing whatever month-specific caption it normally shows (a
// single month name, a vs-last-month comparison). Always starts in
// January of the selected month's own year, matching how every
// year_to_date_*_cents figure is already computed server-side.
const ytdLabel = (month) => {
  const [year, monthNum] = month.split('-').map(Number);
  const abbr = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' });
  return monthNum === 1 ? `Jan ${year}` : `Jan–${abbr} ${year}`;
};


// The smaller cards' grid, by how many are on: one row at desktop width,
// never one card left alone on a second row. Static strings for Tailwind.
// Six cards sit as two rows of three, not one row of six too narrow to read.
const SECONDARY_COLS = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-3 xl:grid-cols-6' };

/* ------------------------------------------------------------------
   The page
   ------------------------------------------------------------------ */

// The eight summary cards' own Month/YTD toggle — separate from the
// Activity chart's Weeks/Months/Years control below, and deliberately
// scoped to just the cards for now: the category/person breakdowns
// and "largest this month" list further down are still one month at
// a time. Extending YTD to those too is a real next step, just a
// bigger one (each needs its own re-aggregated query) than flipping
// which already-fetched number eight cards display.

const VIEW_MODES = [
  { value: 'month', label: 'Month' },
  { value: 'ytd', label: 'YTD' },
];

export function Overview({ accounts = [], people = [], onChange }) {
  // The month and Month/YTD live in the address, remembered for this tab (D380).
  const { month, span: viewMode, setMonth, setSpan: setViewMode } = useOverviewView();
  const [granularity, setGranularity] = useState('month');
  // This month's and last month's categories, for the Spent card's "mostly <category>" (D381).
  // The same request as "Where it's going" for the household, so this month's comes from its cache.
  const lastMonth = currentMonth(addMonths(fromISO(`${month}-01`), -1));
  const whereNow = useApi(viewMode === 'month' ? `where:${month}:month:` : null, () => api.where(month, 'month', ''), { tags: ['transactions'] });
  const whereBefore = useApi(viewMode === 'month' ? `where:${lastMonth}:month:` : null, () => api.where(lastMonth, 'month', ''), { tags: ['transactions'] });
  // The month's summary and the activity chart, together (useApi, D211).
  const main = useApi(`overview:${month}:${granularity}`, () => Promise.all([api.summary(month), api.transactions.trends(granularity, month)]), { tags: ['transactions', 'loans'] });
  const [data, trends] = main.data ?? [null, null];
  // The Zelle card's backlog and this month's net come from the review list (ZelleReview.jsx).
  const zelle = useApi('zelle:all', () => api.zelle.list(), { tags: ['transactions'] });
  const zelleRows = zelle.data ?? null;
  const error = main.error;
  const [dialog, setDialog] = useState(null); // 'salary' | 'spend' | null
  // Which smaller cards show (Settings → Overview cards); every one until the setting loads.
  const visibleCards = useOverviewCards().visible ?? OVERVIEW_CARDS.map((c) => c.key);
  // The sections under "Where it's going" are off unless switched on (Settings → Overview cards, D375).
  const sections = useOverviewSections().shown ?? [];
  // Slim rows, Stats rail or Bento (Settings → Overview cards, D378); Slim rows until it loads.
  const layout = useOverviewLayout().layout ?? 'slim';
  const laptop = useWide('(min-width: 1024px)'); // the rail only stands beside the card from here
  const load = main.reload;
  const loadZelle = zelle.reload;

  if (error) return <p className="text-sm text-spend">{error}</p>;
  if (!data || !trends) return <PageSkeleton />;

  // Month/YTD picks which already-fetched number is the headline on
  // each card — every year_to_date_*_cents figure needed here was
  // already computed server-side for the detail dialogs, so this is
  // just which one eight cards point at, not a new data fetch.
  const isYtd = viewMode === 'ytd';
  const periodCaption = isYtd ? ytdLabel(month) : monthLabel(month);

  const spentCurrent = Math.abs(data.spend.current_spend_cents);
  const spentYtd = Math.abs(data.spend.year_to_date_spend_cents);
  const spent = isYtd ? spentYtd : spentCurrent;
  const prevSpent = Math.abs(data.spend.previous_spend_cents);
  const diff = spentCurrent - prevSpent;
  const driver = whereNow.data && whereBefore.data ? spendDriver(whereNow.data.categories, whereBefore.data.categories, diff) : null;
  const incomeCurrent = data.spend.current_income_cents ?? 0;
  const incomeYtd = data.spend.year_to_date_income_cents ?? 0;
  const income = isYtd ? incomeYtd : incomeCurrent;
  const savings = data.savings ?? { current_savings_cents: 0, year_to_date_savings_cents: 0 };
  const savingsValue = isYtd ? savings.year_to_date_savings_cents : savings.current_savings_cents;
  const savingsNegative = savingsValue < 0;
  const loans = data.loans ?? { total_owed_cents: 0, nearest_deadline: null, loan_count: 0 };
  const loanTypes = loans.loan_types ?? [];
  // The card never hides — it shows what was actually owed AS OF the
  // selected month instead (no amortization/interest modeling, by
  // design — see CLAUDE.md's scope; this is the same statement-first,
  // formula-second, manual-fallback estimate routes/loans.js already
  // computes for "now", just asked about a different date). A month
  // before any loan's start_date has loan_count 0 — genuinely no loan
  // existed yet, not a $0 balance — so the card says so instead of
  // showing a number that isn't really "for" that period. A future
  // month is capped at today server-side rather than projected
  // forward, which would be forecasting.
  const hasLoansThisMonth = (loans.loan_count ?? 0) > 0;

  // Client-computed from GET /api/zelle - see loadZelle above. Needs
  // review is all-time (the whole backlog, not month-scoped); the net
  // figure once nothing's pending is this month's Sent minus Received.
  const zelleNeedsReview = (zelleRows ?? []).filter((r) => !r.zelle_type).length;
  const zelleThisMonth = (zelleRows ?? []).filter((r) => r.zelle_type && r.posted_date.startsWith(month));
  const zelleNetCents = zelleThisMonth.reduce((sum, r) => sum + (r.zelle_type === 'INTERNAL' ? 0 : r.amount_cents), 0);

  const EMPTY_SECONDARY = { current_cents: 0, previous_cents: 0, year_to_date_cents: 0 };
  const secondary = data.secondary ?? {
    cashback_interest: { ...EMPTY_SECONDARY, current_breakdown: {}, year_to_date_breakdown: {} },
    fee_interest: { ...EMPTY_SECONDARY, current_breakdown: {}, year_to_date_breakdown: {}, transactions: [] },
    investment: EMPTY_SECONDARY,
    india_transfer: EMPTY_SECONDARY,
  };
  const secondaryValue = (key) => (isYtd ? secondary[key].year_to_date_cents : secondary[key].current_cents);
  const none = isYtd ? 'None this year' : 'None this month';
  // A flow: its total, or a dash in ink when there's nothing (D311).
  const flow = (key, tone) => {
    const cents = secondaryValue(key);
    return cents === 0 ? { tone: 'ink', value: '—', caption: none } : { tone, value: formatMoney(cents), caption: periodCaption };
  };
  const SECONDARY = {
    cashback_interest: { accent: 'green', icon: <CashbackIcon />, ...flow('cashback_interest', 'earn') },
    fee_interest: { accent: 'red', icon: <FeeIcon />, ...flow('fee_interest', 'spend') },
    investment: { accent: 'blue', icon: <InvestmentIcon />, ...flow('investment', 'ink') },
    india_transfer: { accent: 'teal', icon: <TransferOutIcon />, ...flow('india_transfer', 'spend') },
    zelle: {
      accent: 'pink', icon: <PersonTransferIcon />, tone: 'ink',
      value: zelleNeedsReview > 0 ? `${zelleNeedsReview} to review` : formatMoney(zelleNetCents),
      caption: zelleNeedsReview > 0 ? 'Click to review' : periodCaption,
    },
  };
  // Every open card's credit used, as of the month (D346); not a flow, so the same in Month and YTD.
  const credit = householdUtilisation(data.credit_lines ?? []);
  SECONDARY.credit_used = {
    accent: 'amber', icon: <CreditIcon />, tone: credit?.tone === 'spend' ? 'spend' : 'ink',
    value: credit ? `${credit.pct}%` : '—',
    caption: credit ? `${formatMoney(credit.used)} of ${formatMoney(credit.limit)}` : 'No limits printed',
  };
  const secondaryCards = OVERVIEW_CARDS.filter((c) => visibleCards.includes(c.key)).map((c) => ({ ...c, ...SECONDARY[c.key] }));

  // The four cards: Income, Spent, Loans, Savings — placed by the layout below (D378).
  const kpiCards = (compact = false) => (
    <>
      <SummaryCard
        compact={compact}
        label="Income"
        accent="green"
        icon={<IncomeIcon />}
        tone={income ? 'earn' : 'ink'}
        animated
        value={formatMoney(income)}
        caption={periodCaption}
        onClick={() => setDialog('income')}
      />
      <SummaryCard
        compact={compact}
        label="Spent"
        accent="red"
        icon={<SpentIcon />}
        tone={spent ? 'spend' : 'ink'}
        animated
        value={spent ? `−${formatMoney(spent)}` : formatMoney(0)} // no minus on nothing spent (D253)
        caption={
          !isYtd && prevSpent > 0 && diff !== 0
            ? `${diff > 0 ? '↑' : '↓'} ${formatMoney(Math.abs(diff))} vs last month${driver ? `, mostly ${driver}` : ''}`
            : periodCaption
        }
        onClick={() => setDialog('spend')}
      />
      <SummaryCard
        compact={compact}
        label="Loans"
        accent="amber"
        icon={<LoansIcon />}
        tone="spend"
        animated
        value={hasLoansThisMonth ? formatMoney(loans.total_owed_cents) : 'No loans'}
        caption={
          hasLoansThisMonth && loanTypes.length > 0 ? (
            <span className="flex items-center gap-1.5">
              {loanTypes.slice(0, 3).map((t) => (
                <span key={t} title={LOAN_TYPE_LABEL[t] ?? t}><LoanTypeIcon type={t} /></span>
              ))}
              <span aria-hidden>+</span>
            </span>
          ) : !hasLoansThisMonth && month === currentMonth() ? (
            'Add your first loan'
          ) : null
        }
        onClick={() => setDialog('loans')}
      />
      <SummaryCard
        compact={compact}
        label="Savings"
        accent="purple"
        icon={<SavingsIcon />}
        tone={savingsValue === 0 ? 'ink' : savingsNegative ? 'spend' : 'earn'}
        animated
        value={formatMoney(savingsValue)}
        caption={periodCaption}
        onClick={() => setDialog('savings')}
      />
    </>
  );
  const smallCards = secondaryCards.map((c) => (
    <SummaryCard key={c.key} compact animated={c.key !== 'zelle'} label={c.label} accent={c.accent} icon={c.icon}
      tone={c.tone} value={c.value} caption={c.caption} onClick={() => setDialog(c.key)} />
  ));
  const where = <WhereItsGoing month={month} people={people} span={viewMode} className={layout === 'slim' ? undefined : 'mb-0'} />;

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle className="text-2xl font-medium tracking-tight text-ink" emoji="🏠" tint="bg-vivid-green/15">Overview</PageTitle>
          <p className="mt-1 text-sm text-muted">Calendar months, not statement periods.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <Segmented value={viewMode} onChange={setViewMode} options={VIEW_MODES} />
        </div>
      </header>

      {layout === 'rail' ? (
        // Stats rail (D378): every number in one column, the card beside it at full height.
        // The rail's cards are the one-row kind, so all ten fit beside the card on a laptop.
        <div className="mb-10 grid grid-cols-1 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]" style={{ '--where-above': '15.5rem' }}>
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:flex lg:flex-col lg:gap-2.5 lg:[&>*]:flex-1">
            {kpiCards(laptop)}
            {smallCards}
          </div>
          {where}
        </div>
      ) : layout === 'bento' ? (
        // Bento (D378): the four cards on top, the small ones stacked beside the card, as tall as it.
        <>
          <section className="mb-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">{kpiCards()}</section>
          <div className={`mb-10 grid grid-cols-1 gap-3 ${smallCards.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_17rem]' : ''}`} style={{ '--where-above': '23.5rem' }}>
            {where}
            {smallCards.length > 0 && (
              <div className="order-first grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:order-none lg:flex lg:flex-col lg:gap-2.5 lg:[&>*]:flex-1">{smallCards}</div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Four cards: Income, Spent, Loans, Savings. Equal weight on
              purpose — see the note at the top of this file about why the
              last version of this grid got reverted — but each now
              carries an icon and a top accent bar (style "B" from the
              owner's own four-way comparison), not the plain-text-only
              look from before. */}
          <section className="mb-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">{kpiCards()}</section>

          {/* The smaller cards (Settings → Overview cards): label and number on one
              row. A flow with nothing in the period shows a dash, in ink. The
              grid takes as many columns as there are cards, so none is left alone
              on a row. Zelle shows its review backlog while rows wait (D288). */}
          <section className={`mb-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 ${SECONDARY_COLS[secondaryCards.length] ?? 'lg:grid-cols-4'}`}>
            {smallCards}
          </section>

          {/* Where it's going (D373), right under the cards: the owner moved it up and Activity to the end. */}
          {where}
        </>
      )}

      {sections.includes('by_person') && <ByPersonSection byPerson={data.by_person} people={people} />}
      {sections.includes('largest') && <LargestSection largest={data.largest} byCategory={data.by_category} />}

      {/* Activity, the whole width at the end of the page (D373). Spend mix, its
          old neighbour, was removed (D379): "Where it's going" answers the same question. */}
      {sections.includes('activity') && (
        <div className="mb-10"><ActivitySection data={data} trends={trends} month={month} granularity={granularity} onGranularity={setGranularity} /></div>
      )}

      {dialog === 'income' && (
        <IncomeDetail
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={income}
          yearToDate={data.spend.year_to_date_income_cents}
          incomeByMonth={data.income_by_month}
          byPerson={data.by_person}
          salaryLines={data.salary_lines}
          otherIncome={data.other_income}
          people={people}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'spend' && (
        <SpendDetail
          month={monthLabel(month)}
          year={month.slice(0, 4)}
          total={spent}
          yearToDate={data.spend.year_to_date_spend_cents}
          spendByMonth={data.spend_by_month}
          byPerson={data.by_person}
          byPersonCategory={data.spend_by_person_category}
          zelleSent={data.zelle_sent}
          people={people}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'savings' && (
        <SavingsDetail
          month={month}
          people={people}
          onAccountsChanged={onChange}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'loans' && (
        <LoansDetail accounts={accounts} month={month} onClose={() => setDialog(null)} onChanged={onChange} />
      )}
      {dialog === 'cashback_interest' && <CashbackDetail month={month} onClose={() => setDialog(null)} />}
      {dialog === 'fee_interest' && <FeesDetail month={month} onClose={() => setDialog(null)} />}
      {dialog === 'credit_used' && <CreditDetail month={month} onClose={() => setDialog(null)} />}
      {dialog === 'investment' && <FlowDetail flow="investment" month={month} onClose={() => setDialog(null)} />}
      {dialog === 'india_transfer' && <FlowDetail flow="india" month={month} onClose={() => setDialog(null)} />}
      {dialog === 'zelle' && (
        <ZelleDetail
          month={month}
          startInReview={zelleNeedsReview > 0}
          onClose={() => setDialog(null)}
          onChanged={() => { loadZelle(); load(); }}
        />
      )}
    </div>
  );
}
