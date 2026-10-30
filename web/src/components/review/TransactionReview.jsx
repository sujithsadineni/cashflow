import { useSearchParams } from 'react-router-dom';
import { GlassReview } from './GlassReview';
import { GlassMerchantsPane, GlassDuplicatesPane } from './GlassReviewPanes';
import { ReviewStatements, ReviewPayments } from './ReviewLists';

/**
 * The Review page (D212, /review). It was a pop-up on Transactions until
 * it grew five tabs, count tiles and deep links; now it has its own place
 * in the sidebar with a count badge, and the tab lives in the address bar
 * (?tab=payments) so a toast, a bookmark or Back lands on the right one.
 *
 * One page for every design (D305): the Apple triage built for Glass (a
 * list beside the row being fixed, keyboard first, Undo on every save).
 * Classic's older form-per-row layout is gone; Classic and Vivid draw the
 * same page in their own tokens.
 */
const TABS = ['findings', 'statements', 'silent', 'payments', 'duplicates', 'merchants'];

export function TransactionReview(props) {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'findings';
  return (
    <GlassReview
      {...props}
      tab={tab}
      setTab={(value) => setParams({ tab: value }, { replace: true })}
      StatementsPane={ReviewStatements}
      PaymentsPane={ReviewPayments}
      MerchantsPane={() => <GlassMerchantsPane onResolved={props.onResolved} />}
      DuplicatesPane={GlassDuplicatesPane}
    />
  );
}
