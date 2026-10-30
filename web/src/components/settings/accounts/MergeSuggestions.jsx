import { api } from '../../../api';
import { invalidate, useApi } from '../../../hooks/use-api';
import { useConfirm } from '../../../hooks/use-confirm';
import { useNotify } from '../../../hooks/use-notify';
import { Button } from '../../ui/Form';

const label = (a) => `${a.name}${a.mask ? ` ··${a.mask}` : ''}`;

/**
 * Accounts that look like one card under two numbers (D411): a card reissued (expired, lost,
 * stolen, replaced) or upgraded to another tier, imported as a second account. Its statements
 * carry the older account's balance over, and the two never overlap. Each is offered as a merge,
 * confirmed first; the older account's history moves to the newer and it's deactivated.
 */
export function MergeSuggestions({ onMerged }) {
  const req = useApi('account-merges', () => api.accounts.mergeSuggestions(), { tags: ['reference', 'imports'] });
  const confirm = useConfirm();
  const notify = useNotify();
  const pairs = req.data ?? [];
  if (pairs.length === 0) return null;

  const merge = async ({ from, into }) => {
    const ok = await confirm({
      title: `Merge ${label(from)} into ${label(into)}?`,
      message: `Its statements, transactions and bills move to ${label(into)}, and ${label(from)} closes. Its card number stays in the card's history.`,
      confirm: 'Merge',
    });
    if (!ok) return;
    try {
      await api.accounts.merge(from.id, into.id);
      invalidate('reference', 'transactions', 'imports');
      notify(`${label(from)} is now part of ${label(into)}`, { name: 'account.merged' });
      onMerged?.();
    } catch (err) {
      notify(err.message, { name: 'error.app' });
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-warn/40 bg-raised p-4">
      <p className="text-sm font-medium text-ink">These look like one card under two numbers</p>
      <p className="mt-0.5 text-sm text-muted">A reissued, replaced or upgraded card: its new statements carry the old balance over.</p>
      <ul className="mt-3 space-y-2">
        {pairs.map((p) => (
          <li key={`${p.from.id}-${p.into.id}`} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink tnum">{label(p.from)} <span className="text-faint">→</span> {label(p.into)}</span>
            <Button variant="quiet" onClick={() => merge(p)}>Merge</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
