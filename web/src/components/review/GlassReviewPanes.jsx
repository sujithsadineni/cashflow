import { MerchantReview } from './MerchantReview';
import { DuplicateReview } from './DuplicateReview';
import { GroupSection, Group } from '../settings/glass-ui';

/**
 * Review → Merchants (D249 step 3): MerchantReview in a grouped list.
 * Statements, Silent months and Payments are split views (ReviewLists.jsx, D319).
 */
export function GlassMerchantsPane({ onResolved }) {
  return (
    <GroupSection footnote="Statement lines the app couldn't name with confidence. Approving a name teaches every later import.">
      <Group as="div" className="px-4 py-3">
        <MerchantReview embedded onResolved={onResolved} />
      </Group>
    </GroupSection>
  );
}

/** Review → Duplicates (D328): the same purchase saved from two statements. */
export function GlassDuplicatesPane() {
  return (
    <GroupSection footnote="A pair is the same amount on the same card within three days, on two different statements. Each is scored by re-reading both PDFs and checking whether each statement adds up with its copy. Removing a copy deletes it; the audit log keeps the whole row.">
      <Group as="div" className="apple-pane px-4 py-3">
        <DuplicateReview />
      </Group>
    </GroupSection>
  );
}
