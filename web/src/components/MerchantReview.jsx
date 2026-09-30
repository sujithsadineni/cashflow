import { useEffect, useState } from 'react';
import { api, formatMoney, formatShortDate } from '../api';
import { MerchantAvatar } from './MerchantAvatar';
import { Button } from './Form';

/**
 * The queue behind the Review button on Transactions: merchant
 * matches the auto-scan wasn't confident enough to apply on its own
 * (see api/src/merchant-review.js) wait here for a person to confirm.
 * Same modal shape as MerchantHistory — a drill-down popover, not a
 * page of its own.
 */
export function MerchantReview({ onClose, onResolved }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    api.merchantReview.list()
      .then(setItems)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const resolve = async (id, action) => {
    setBusyId(id);
    try {
      await api.merchantReview[action](id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      onResolved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-rule bg-raised p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-ink">Merchant review</h3>
            <p className="mt-0.5 text-xs text-muted">
              Possible matches the auto-scan wasn't confident enough to apply on its own.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-spend">{error}</p>}

        {!items && !error && <p className="text-sm text-muted">Loading…</p>}

        {items && items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">Nothing to review right now.</p>
        )}

        {items && items.length > 0 && (
          <ul className="divide-y divide-rule">
            {items.map((item) => (
              <li key={item.id} className="py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm text-ink">
                      <span className="truncate">{item.current_merchant ?? item.description}</span>
                      <span className="text-faint">→</span>
                      <span className="flex items-center gap-1.5 truncate font-medium">
                        <MerchantAvatar merchant={item.suggested_merchant} size={18} />
                        {item.suggested_merchant}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-faint" title={item.description}>
                      {item.reason}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <span className="font-mono tnum">{formatShortDate(item.posted_date)}</span>
                      <span className={`font-mono tnum ${item.amount_cents < 0 ? 'text-spend' : 'text-earn'}`}>
                        {formatMoney(item.amount_cents, { showSign: true })}
                      </span>
                      <span>{item.account_name}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busyId === item.id}
                      onClick={() => resolve(item.id, 'dismiss')}
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyId === item.id}
                      onClick={() => resolve(item.id, 'approve')}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
