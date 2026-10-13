/**
 * Promotional rates, read off a statement's interest-charge table (D192).
 * Runs over every page's text, boilerplate included — the APR table is
 * on a page the extractor never sees — on both the free and the Claude
 * path, so it costs nothing either way.
 *
 * Two layouts, confirmed against real statements:
 *   Barclays: "Balance Transfer/Check Promotion   04/05/27   $16,733.33   0.00%   $0.00",
 *             after "Standard Balance Transfers/Checks   -   $0.00   29.74%(v)   $0.00"
 *   BofA:     "Promotional APR   0.00%   DD   LR25-05262   10/13/2027   $ 5,550.55   $ 0.00",
 *             after "28.24%V   Direct Deposit and Check Cash $ 0.00   $ 0.00"
 *
 * The rate printed just before a promo line is its section's standard
 * rate: what the balance moves to once the promo ends.
 *
 * Pure: pages in, promos out. Tested in promos.test.js.
 */

import { parseMoney } from './pdf-local-helpers.js';

/** "29.74" -> 2974. Integer maths on the printed digits, no float. */
export function pctToBps(text) {
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
}

const kindFromLabel = (label) =>
  /balance transfer/i.test(label) ? 'balance_transfer'
    : /cash advance|direct deposit|check/i.test(label) ? 'cash_advance'
      : /purchase/i.test(label) ? 'purchase'
        : 'other';

// BofA's "Promotional Transaction Type" codes, printed in its APR legend.
const BOFA_TYPES = { BT: 'balance_transfer', DD: 'cash_advance', CK: 'cash_advance', PUR: 'purchase', PU: 'purchase' };
const BOFA_LABELS = { BT: 'Balance transfer promotion', DD: 'Direct deposit promotion', CK: 'Check promotion', PUR: 'Purchase promotion', PU: 'Purchase promotion' };

const BARCLAYS_PROMO = /^(.*Promotion)\s+(\d{2})\/(\d{2})\/(\d{2})\s+(\$[\d,]*\.\d{2})\s+([\d.]+)%/i;
const BARCLAYS_STANDARD = /^Standard .*?\s([\d.]+)%/i;
const BOFA_PROMO = /^Promotional APR\s+([\d.]+)%\s+([A-Z]{2,3})\s+(\S+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\$\s?[\d,]*\.\d{2})/;
const BOFA_STANDARD = /^([\d.]+)%V?\s+[A-Za-z]/;

/**
 * @param pages - [{ text }]
 * @returns [{ kind, label, offer_id, apr_bps, standard_apr_bps, end_date, balance_subject_cents }]
 */
export function extractPromos(pages) {
  const promos = [];
  let standard = null;
  for (const raw of pages.flatMap((p) => (p.text ?? '').split('\n'))) {
    const line = raw.trim();
    let m;
    if ((m = BARCLAYS_STANDARD.exec(line)) || (m = BOFA_STANDARD.exec(line))) {
      standard = pctToBps(m[1]);
    } else if ((m = BARCLAYS_PROMO.exec(line))) {
      const [, label, mm, dd, yy, balance, apr] = m;
      promos.push({
        kind: kindFromLabel(label),
        label: label.trim(),
        offer_id: null,
        apr_bps: pctToBps(apr),
        standard_apr_bps: standard,
        end_date: `20${yy}-${mm}-${dd}`,
        balance_subject_cents: parseMoney(balance.replace(/\s/g, '')),
      });
    } else if ((m = BOFA_PROMO.exec(line))) {
      const [, apr, type, offer, mm, dd, yyyy, balance] = m;
      promos.push({
        kind: BOFA_TYPES[type] ?? 'other',
        label: BOFA_LABELS[type] ?? `Promotion (${type})`,
        offer_id: offer,
        apr_bps: pctToBps(apr),
        standard_apr_bps: standard,
        end_date: `${yyyy}-${mm}-${dd}`,
        balance_subject_cents: parseMoney(balance.replace(/\s/g, '')),
      });
    }
  }
  return promos;
}
