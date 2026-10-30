/**
 * The colours and surface of each toast look (D387, four kept D388), shared by
 * the live toast and Settings' previews.
 *
 * Vivid's colour says the kind: red a problem, amber a note, blue when it can
 * be undone, green otherwise. Text sits on it, so each kind has a deep shade
 * for anything with words on it (Candy's card, Sticker's button) that keeps
 * white text at 4.5:1 or better, WCAG's bar for small text; the bright shade is
 * for edges. The app's own --color-vivid-* are too light for white words (amber
 * 2:1, red 3.9:1, green in dark 2.6:1), so these are their deeper relatives.
 */
export const VIVID_KINDS = {
  error: { bright: 'var(--color-vivid-red)', deep: '#C62F35' },
  info: { bright: 'var(--color-vivid-amber)', deep: '#B45309' },
  undo: { bright: 'var(--color-vivid-blue)', deep: '#3451C7' },
  done: { bright: 'var(--color-vivid-green)', deep: '#17784A' },
};

/** Vivid's colours for a toast. */
export function vividTone(toast) {
  if (toast.type === 'error') return VIVID_KINDS.error;
  if (toast.type === 'info') return VIVID_KINDS.info;
  if (toast.action?.label === 'Undo') return VIVID_KINDS.undo;
  return VIVID_KINDS.done;
}

/** The card's own surface for a look: its classes and colours. */
export function cardLook(look, toast) {
  const { bright, deep } = vividTone(toast);
  switch (look) {
    case 'island': return { className: 'rounded-[30px] bg-black text-white shadow-[0_12px_34px_rgb(0_0_0/0.35)]', style: {} };
    case 'candy': return { className: 'rounded-[20px] text-white', style: { background: deep, boxShadow: `0 14px 30px -12px ${deep}` } };
    case 'sticker': return { className: 'rounded-[18px] border-2 bg-raised text-ink', style: { borderColor: bright, boxShadow: `0 5px 0 ${bright}` } };
    default: return { className: 'toast-card rounded-[22px] border border-rule bg-raised text-ink shadow-lg', style: {} };
  }
}

/** WCAG contrast between two #rrggbb colours (for the tests and the E2E). */
export function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
