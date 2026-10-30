import { txnName, zelleParts, showsZelleName } from '../../lib/transactions/txn-name';

/**
 * A transaction's name in a list (D396): txnName's words, with a Zelle
 * memo set apart in its own type ("From Jordan Lee — “rent”"), so the
 * note someone typed doesn't read as part of their name. Everywhere else
 * (a toast, a tooltip, a rename field) uses txnName's plain text.
 */
export function TxnName({ t, fallback = null }) {
  if (!showsZelleName(t)) return txnName(t) ?? fallback;
  const { direction, person, memo } = zelleParts(t);
  if (!memo) return `${direction} ${person}`;
  // In a narrow column the name gives way first, so the memo stays readable (each cut with "…").
  return (
    <span className="flex min-w-0 items-baseline">
      <span className="min-w-0 truncate">{direction} {person}</span>
      <span className="txn-memo min-w-0 max-w-[60%] shrink-0 truncate pr-1 font-normal italic text-muted">&nbsp;— “{memo}”</span>
    </span>
  );
}
