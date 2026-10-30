/**
 * Searching for a merchant's logo (D301). The household presses Search;
 * the merchant's name goes to Clearbit's public company autocomplete, which
 * answers with companies by that name and their websites. Each website is
 * kept only when it has an icon of its own (DuckDuckGo's icon service says
 * 404 when it doesn't), so every suggestion shown has a real logo. The
 * person picks one; nothing is applied on its own, because a local
 * restaurant's name often matches a different business somewhere else.
 *
 * Only the typed name leaves the machine, only on Search. A service that's
 * down or slow gives an empty list and a reason, never an error page.
 * `fetcher` is injected so this is tested without the network.
 */

import { cleanDomain } from './merchant-names.js';

const SUGGEST = 'https://autocomplete.clearbit.com/v1/companies/suggest?query=';
const ICON = (domain) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;
const MAX = 6;
const TIMEOUT_MS = 5000;

async function hasIcon(fetcher, domain) {
  try {
    const res = await fetcher(ICON(domain), { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * @returns { results: [{ name, domain }], unavailable?: true }
 */
export async function searchLogos(query, fetcher = fetch) {
  const q = (query ?? '').trim().slice(0, 80);
  if (!q) return { results: [] };
  let found;
  try {
    const res = await fetcher(SUGGEST + encodeURIComponent(q), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { results: [], unavailable: true };
    found = await res.json();
    if (!Array.isArray(found)) return { results: [], unavailable: true };
  } catch {
    return { results: [], unavailable: true };
  }

  const seen = new Set();
  const candidates = [];
  for (const c of found) {
    const domain = cleanDomain(c?.domain ?? '');
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    candidates.push({ name: String(c.name ?? domain).slice(0, 80), domain });
    if (candidates.length === MAX) break;
  }
  const checked = await Promise.all(candidates.map(async (c) => ((await hasIcon(fetcher, c.domain)) ? c : null)));
  return { results: checked.filter(Boolean) };
}
