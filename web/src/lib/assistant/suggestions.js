/**
 * Questions the assistant panel suggests as you type (D332). The API builds
 * them from what the household spends on most (/assistant/suggestions);
 * this list is the stand-in until it loads. Each has the question and a
 * short note of what it answers.
 */
export const SUGGESTIONS = [
  { text: 'How much did I pay for rent this year?', note: 'Rent · year to date' },
  { text: 'Rent by month this year', note: 'Rent · by month' },
  { text: 'Utilities this month vs last month', note: 'Utilities · compare' },
  { text: 'Utilities by month this year', note: 'Utilities · by month' },
  { text: 'Groceries year to date', note: 'Groceries · year to date' },
  { text: 'Top 10 merchants last month', note: 'Merchants · top' },
  { text: 'Dining this month vs same month last year', note: 'Dining · compare' },
  { text: 'Biggest purchases this year', note: 'Transactions · top' },
  { text: 'Top 10 merchants this year', note: 'Merchants · top' },
];

const words = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * The suggestions holding every word typed, in list order, each split into
 * parts for highlighting: [{ text, hit }]. No words: the first `limit`, unmarked.
 */
export function matchSuggestions(typed, list = SUGGESTIONS, limit = 6) {
  const ws = words(typed);
  return list
    .filter((s) => ws.every((w) => s.text.toLowerCase().includes(w)))
    .slice(0, limit)
    .map((s) => ({ ...s, parts: highlight(s.text, ws) }));
}

/** `text` cut into runs that match one of `ws` (case-insensitive) and runs that don't. */
export function highlight(text, ws) {
  const lower = text.toLowerCase();
  const hit = new Array(text.length).fill(false);
  for (const w of ws) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) hit.fill(true, i, i + w.length);
  }
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last && last.hit === hit[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: hit[i] });
  }
  return parts;
}
