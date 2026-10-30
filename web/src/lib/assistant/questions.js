/**
 * Saved questions (D332): when each was asked, in words, and which ones
 * have an answer not opened yet. Pure, so they're tested without a browser.
 */

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** "Today 9:14 PM", "Yesterday 8:02 AM", "Oct 20", or "Oct 20, 2025" in another year. */
export function askedLabel(timestamp, now = new Date()) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return `Today ${time(d)}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday ${time(d)}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
}

/** An answer the person hasn't opened yet. */
export const isNewAnswer = (q) => q.status === 'answered' && !q.seen_at;
