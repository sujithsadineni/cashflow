/**
 * Where each statement line sits on its page (D335), so the statement
 * dialog can show the real PDF beside the rows and light the line a row
 * came from. pdf.js hands back positioned words, not lines; they're grouped
 * by their baseline the way parse/pdf-pages.js groups them for reading, but
 * keeping each line's box, as fractions of the page so any rendered size
 * lines up.
 *
 * A row is matched to the line printing its amount and its date or first
 * word, in statement order: each match searches on from the one before, so
 * three "INTEREST CHARGED 0.00" lines land on three different lines. A row
 * nothing matches (a line Claude read from a picture, say) has no box, and
 * the dialog simply doesn't light anything for it.
 */

/** pdf.js text items of one page → lines with boxes in page fractions, top to bottom. */
export function pageLines(items, width, height) {
  const words = items
    .filter((it) => it.str && it.str.trim() !== '')
    .map((it) => {
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, size };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const word of words) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - word.y) <= 2) line.words.push(word);
    else lines.push({ y: word.y, words: [word] });
  }
  return lines.map(({ words: ws }) => {
    ws.sort((a, b) => a.x - b.x);
    const top = Math.max(...ws.map((w) => w.y + w.size * 0.8));
    const bottom = Math.min(...ws.map((w) => w.y - w.size * 0.25));
    return {
      text: ws.map((w) => w.str).join(' ').replace(/\s+/g, ' ').trim(),
      left: Math.min(...ws.map((w) => w.x)) / width,
      right: Math.max(...ws.map((w) => w.x + w.w)) / width,
      top: 1 - top / height,
      bottom: 1 - bottom / height,
    };
  });
}

const money = (cents) => {
  const abs = Math.abs(cents);
  const plain = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return [plain, plain.replace(/\B(?=(\d{3})+(?!\d))/g, ',')];
};

/** How well a printed line fits a row: its amount is required, then its date and first word. */
export function lineScore(text, row) {
  if (row.amount_cents == null) return 0;
  const hay = ` ${text.toLowerCase()} `;
  const [plain, grouped] = money(row.amount_cents);
  const amountAt = (s) => new RegExp(`(?<![\\d.,])\\$?-?${s.replace(/[.,]/g, '\\$&')}(?![\\d])`).test(hay);
  if (!amountAt(plain) && !amountAt(grouped)) return 0;
  let score = 2;
  if (row.posted_date) {
    const [, m, d] = row.posted_date.split('-');
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    if (hay.includes(`${m}/${d}`) || hay.includes(`${Number(m)}/${Number(d)}`) || hay.includes(`${months[Number(m) - 1]} ${Number(d)} `)) score += 1;
  }
  const word = (row.description ?? '').toLowerCase().match(/[a-z]{3,}/)?.[0];
  if (word && hay.includes(word)) score += 1;
  return score;
}

/**
 * Rows (in statement order) → { [row id]: { page, left, right, top, bottom } }.
 * `pages` is [{ n, lines }]. Needs the amount and one more thing to match.
 */
export function locateRows(pages, rows) {
  const flat = pages.flatMap((p) => p.lines.map((line) => ({ ...line, page: p.n })));
  const used = new Set();
  const found = {};
  let from = 0;
  for (const row of rows) {
    const pick = (start, end) => {
      let best = -1;
      let bestScore = 2;
      for (let i = start; i < end; i++) {
        if (used.has(i)) continue;
        const s = lineScore(flat[i].text, row);
        if (s > bestScore) { best = i; bestScore = s; if (s === 4) break; }
      }
      return best;
    };
    let at = pick(from, flat.length);
    if (at === -1) at = pick(0, from); // a row the statement prints earlier than the one before it
    if (at === -1) continue;
    used.add(at);
    from = at + 1;
    const { page, left, right, top, bottom } = flat[at];
    found[row.id] = { page, left, right, top, bottom };
  }
  return found;
}
