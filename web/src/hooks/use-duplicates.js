import { api } from '../api';
import { useApi } from './use-api';

/**
 * Possible duplicates for Review (D328): the pairs and the tab's badge.
 * Re-judged when statements or rows change, and when a pair is answered.
 * Kept apart from the component (fast refresh).
 */
export const useDuplicates = () => useApi('duplicates', () => api.duplicates.list(), { tags: ['duplicates', 'imports', 'transactions'] });

/** The tab's badge: pairs worth a look (a proven duplicate or a likely guess), not the ones proven real. */
export function useDuplicateCount() {
  return useDuplicates().data?.filter((p) => p.score >= 50).length ?? 0;
}
